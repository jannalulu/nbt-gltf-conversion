import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

class BlockModelRenderer {
  constructor(scene) {
    this.scene = scene
    this.geometryCache = new Map()
    this.materialCache = new Map()
    
    // Default geometry for blocks without models (full 1x1x1 block)
    this.defaultGeometry = new THREE.BoxGeometry(1, 1, 1)
    this.defaultGeometry.translate(0.5, 0.5, 0.5)
  }

  createGeometryFromModel(model) {
    if (!model?.elements?.length) {
      return this.defaultGeometry.clone()
    }

    const geometries = []
    
    for (const element of model.elements) {
      try {
        if (!element.from || !element.to || 
            element.from.length !== 3 || element.to.length !== 3) {
          continue
        }

        // Model loader already scaled coordinates to 0-1
        const from = element.from
        const to = element.to
        
        // Calculate dimensions
        const size = [
          Math.abs(to[0] - from[0]) / 16,
          Math.abs(to[1] - from[1]) / 16,
          Math.abs(to[2] - from[2]) / 16
        ]

        // Add small offset to prevent z-fighting
        const geometry = new THREE.BoxGeometry(
          Math.max(size[0], 0.001),
          Math.max(size[1], 0.001),
          Math.max(size[2], 0.001)
        )

        // Position relative to block origin
        const position = [
          from[0] + size[0] / 2,
          from[1] + size[1] / 2,
          from[2] + size[2] / 2
        ]
        
        geometry.translate(...position)

        // Handle rotations
        if (element.rotation) {
          const { origin, angle, axis } = element.rotation
          
          if (origin && origin.length === 3) {
            // Model loader already scaled rotation origin
            const rotOrigin = origin
            
            geometry.translate(
              -rotOrigin[0],
              -rotOrigin[1],
              -rotOrigin[2]
            )
            
            const rotAngle = angle * Math.PI / 180
            const rotMatrix = new THREE.Matrix4()
            
            switch (axis) {
              case 'x': rotMatrix.makeRotationX(rotAngle); break
              case 'y': rotMatrix.makeRotationY(rotAngle); break
              case 'z': rotMatrix.makeRotationZ(rotAngle); break
            }
            
            geometry.applyMatrix4(rotMatrix)
            
            geometry.translate(
              rotOrigin[0],
              rotOrigin[1],
              rotOrigin[2]
            )
          }
        }

        // UV mapping
        if (element.faces) {
          const faceMap = {
            east:  0,
            west:  1,
            up:    2,
            down:  3,
            south: 4,
            north: 5
          }

          const uvAttribute = geometry.attributes.uv
          
          for (const [faceName, faceData] of Object.entries(element.faces)) {
            if (!faceData?.uv || faceData.uv.length !== 4 || 
                !(faceName in faceMap)) {
              continue
            }

            const faceIndex = faceMap[faceName]
            const baseIndex = faceIndex * 8
            
            // Model loader already scaled UVs
            const uv = faceData.uv
            
            if (faceData.rotation) {
              const rad = (faceData.rotation * Math.PI) / 180
              const center = [
                (uv[0] + uv[2]) / 2,
                (uv[1] + uv[3]) / 2
              ]
              
              const rotatePoint = (u, v) => {
                const du = u - center[0]
                const dv = v - center[1]
                const cos = Math.cos(rad)
                const sin = Math.sin(rad)
                return [
                  center[0] + du * cos - dv * sin,
                  center[1] + du * sin + dv * cos
                ]
              }

              const uv1 = rotatePoint(uv[0], uv[1])
              const uv2 = rotatePoint(uv[2], uv[1])
              const uv3 = rotatePoint(uv[0], uv[3])
              const uv4 = rotatePoint(uv[2], uv[3])

              uvAttribute.array[baseIndex    ] = uv1[0]
              uvAttribute.array[baseIndex + 1] = uv1[1]
              uvAttribute.array[baseIndex + 2] = uv2[0]
              uvAttribute.array[baseIndex + 3] = uv2[1]
              uvAttribute.array[baseIndex + 4] = uv3[0]
              uvAttribute.array[baseIndex + 5] = uv3[1]
              uvAttribute.array[baseIndex + 6] = uv4[0]
              uvAttribute.array[baseIndex + 7] = uv4[1]
            } else {
              uvAttribute.array[baseIndex    ] = uv[0]
              uvAttribute.array[baseIndex + 1] = uv[1]
              uvAttribute.array[baseIndex + 2] = uv[2]
              uvAttribute.array[baseIndex + 3] = uv[1]
              uvAttribute.array[baseIndex + 4] = uv[0]
              uvAttribute.array[baseIndex + 5] = uv[3]
              uvAttribute.array[baseIndex + 6] = uv[2]
              uvAttribute.array[baseIndex + 7] = uv[3]
            }
          }

          uvAttribute.needsUpdate = true
        }

        geometry.computeBoundingSphere()
        geometries.push(geometry)

      } catch (error) {
        console.warn('Error processing element:', error)
        continue
      }
    }

    try {
      if (geometries.length === 0) {
        return this.defaultGeometry.clone()
      } else if (geometries.length === 1) {
        return geometries[0]
      } else {
        const mergedGeometry = mergeGeometries(geometries, false)
        geometries.forEach(g => g.dispose())
        return mergedGeometry || this.defaultGeometry.clone()
      }
    } catch (error) {
      console.warn('Error merging geometries:', error)
      return this.defaultGeometry.clone()
    }
  }

  createBlockMesh(blockId, model, textures, blockStates, uvMapping) {
    try {
      if (!model) {
        model = {
          elements: [{
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: {
              north: { uv: [0, 0, 16, 16] },
              south: { uv: [0, 0, 16, 16] },
              east: { uv: [0, 0, 16, 16] },
              west: { uv: [0, 0, 16, 16] },
              up: { uv: [0, 0, 16, 16] },
              down: { uv: [0, 0, 16, 16] }
            }
          }]
        }
      }

      const geometry = this.createGeometryFromModel(model)
      if (!geometry) return null

      const material = this.createMaterial(blockId)
      
      // Enable face culling for proper 3D rendering
      material.side = THREE.FrontSide
      
      return new THREE.Mesh(geometry, material)

    } catch (error) {
      console.warn('Error creating block mesh:', error)
      return null
    }
  }
}

export default BlockModelRenderer