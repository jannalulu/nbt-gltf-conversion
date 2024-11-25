import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

class BlockModelRenderer {
  constructor(scene) {
    this.scene = scene
    this.geometryCache = new Map()
    this.materialCache = new Map()
    
    this.defaultGeometry = new THREE.BoxGeometry(1, 1, 1)
    this.defaultGeometry.translate(0.5, 0.5, 0.5)
  }

  createBlockMesh(blockId, model, textures, blockStates, uvMapping) {
    try {
      if (!model?.elements?.length) {
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

      // Special material handling for lanterns
      const material = this.createMaterial(blockId)
      if (blockId === 'lantern' || model.parent?.includes('lantern')) {
        material.transparent = true
        material.opacity = 1.0
        material.alphaTest = 0.1
        material.side = THREE.DoubleSide
        material.emissive = new THREE.Color(0xffa726)
        material.emissiveIntensity = 0.6
      } else {
        material.side = THREE.FrontSide
      }
      
      return new THREE.Mesh(geometry, material)

    } catch (error) {
      console.warn('Error creating block mesh:', error)
      return null
    }
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

        const from = element.from
        const to = element.to
        
        const size = [
          Math.abs(to[0] - from[0]) / 16,
          Math.abs(to[1] - from[1]) / 16,
          Math.abs(to[2] - from[2]) / 16
        ]

        // Create geometry with exact dimensions
        const geometry = new THREE.BoxGeometry(
          Math.max(size[0], 0.001),
          Math.max(size[1], 0.001),
          Math.max(size[2], 0.001)
        )

        // Position relative to block origin
        const position = [
          (from[0] / 16) + (size[0] / 2),
          (from[1] / 16) + (size[1] / 2),
          (from[2] / 16) + (size[2] / 2)
        ]
        
        geometry.translate(...position)

        // Handle rotations
        if (element.rotation) {
          const { origin, angle, axis } = element.rotation
          
          if (origin && origin.length === 3) {
            const rotOrigin = origin.map(v => v / 16)
            
            geometry.translate(
              -rotOrigin[0],
              -rotOrigin[1],
              -rotOrigin[2]
            )
            
            const rotAngle = angle * Math.PI / 180
            switch (axis) {
              case 'x': geometry.rotateX(rotAngle); break
              case 'y': geometry.rotateY(rotAngle); break
              case 'z': geometry.rotateZ(rotAngle); break
            }
            
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
            
            // Scale UVs to 0-1 space if not already scaled
            const uv = faceData.uv.map(v => v > 1 ? v / 16 : v)
            
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
}

export default BlockModelRenderer