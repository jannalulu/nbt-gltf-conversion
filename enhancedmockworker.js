import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import BlockModelLoader from './blockmodelloader.js'

class EnhancedMockWorker {
  constructor(scene, mcData) {
    this.scene = scene
    this.mcData = mcData
    this.meshes = new Map()
    this.atlas = null
    this.uvMapping = null
    this.geometryCache = new Map()
    this.modelLoader = null
    this.materialCache = new Map()
  }

  async initialize(assetsDirectory) {
    try {
      console.log('Initializing worker with assets directory:', assetsDirectory)
      this.modelLoader = new BlockModelLoader(assetsDirectory)
      await this.modelLoader.loadBlockModels()
      console.log('Worker initialization complete')
      return true
    } catch (error) {
      console.error('Worker initialization failed:', error)
      throw error
    }
  }

  setAtlas(atlas, uvMapping) {
    if (!atlas || !uvMapping) {
      console.warn('Invalid atlas data provided')
      return
    }
    this.atlas = atlas
    this.uvMapping = uvMapping
  }

  createGeometryFromModel(model) {
    if (!model?.elements) {
      return new THREE.BoxGeometry(1, 1, 1)
    }

    const geometries = model.elements.map(element => {
      const from = element.from.map(v => v / 16)
      const to = element.to.map(v => v / 16)

      const size = {
        x: Math.abs(to[0] - from[0]),
        y: Math.abs(to[1] - from[1]),
        z: Math.abs(to[2] - from[2])
      }

      const center = {
        x: from[0] + size.x / 2 - 0.5,
        y: from[1] + size.y / 2 - 0.5,
        z: from[2] + size.z / 2 - 0.5
      }

      const geometry = new THREE.BoxGeometry(size.x, size.y, size.z)
      geometry.translate(center.x, center.y, center.z)

      if (element.rotation) {
        const origin = element.rotation.origin.map(v => v / 16 - 0.5)
        const angle = (element.rotation.angle * Math.PI) / 180

        geometry.translate(-origin[0], -origin[1], -origin[2])
        
        switch (element.rotation.axis) {
          case 'x': geometry.rotateX(angle); break
          case 'y': geometry.rotateY(angle); break
          case 'z': geometry.rotateZ(angle); break
        }

        geometry.translate(origin[0], origin[1], origin[2])
      }

      return geometry
    })

    if (geometries.length === 0) {
      return new THREE.BoxGeometry(1, 1, 1)
    } else if (geometries.length === 1) {
      return geometries[0]
    } else {
      try {
        const mergedGeometry = mergeGeometries(geometries)
        geometries.forEach(g => g.dispose())
        return mergedGeometry
      } catch (error) {
        console.warn('Failed to merge geometries:', error)
        return geometries[0]
      }
    }
  }

  createMaterial(blockId, model) {
    const block = this.mcData.blocks[blockId]
    if (!block || !model?.textures) {
      console.warn('Missing block or textures for material:', blockId)
      return new THREE.MeshStandardMaterial()
    }

    console.log('Creating material for:', {
      blockName: block.name,
      textures: model.textures,
      isTransparent: block.transparent
    })

    const material = new THREE.MeshStandardMaterial({
      name: block.name,
      transparent: block.transparent,
      side: block.transparent ? THREE.DoubleSide : THREE.FrontSide,
      roughness: 1.0,
      metalness: 0.0,
      alphaTest: block.transparent ? 0.1 : 0
    })

    if (this.atlas && model.textures) {
      let textureKey = model.textures.all || 
                      model.textures.texture || 
                      model.textures.particle || 
                      model.textures.side || 
                      model.textures.top || 
                      model.textures.lantern

      if (textureKey) {
        textureKey = textureKey.replace('minecraft:', '')
                              .replace('block/', '')
                              .replace('blocks/', '')

        console.log('Looking for texture:', {
          block: block.name,
          textureKey,
          hasMapping: textureKey in this.uvMapping
        })

        const uvs = this.uvMapping[textureKey]
        if (uvs) {
          const texture = this.atlas.clone()
          texture.repeat.set(uvs.width, uvs.height)
          texture.offset.set(uvs.x, uvs.y)
          texture.magFilter = THREE.NearestFilter
          texture.minFilter = THREE.NearestFilter
          texture.needsUpdate = true
          
          material.map = texture
          material.needsUpdate = true
        }
      }
    }

    return material
  }

  getBlockModel(blockName) {
    console.log('Looking for model in models:', {
      name: blockName,
      modelKeys: Object.keys(this.modelLoader.blockModels).filter(k => k.includes(blockName))
    })

    // Try multiple variations of the name
    const variants = [
      blockName,
      `block/${blockName}`,
      `${blockName}_north`,  // For beds
      `${blockName}_head`,   // For beds
      `${blockName}_foot`,   // For beds
      `${blockName}_post`,   // For glass panes
      `${blockName}_side`,   // For glass panes
      blockName.replace('block/', '')
    ]

    for (const variant of variants) {
      const model = this.modelLoader.getModel(variant)
      if (model) {
        console.log('Found model using variant:', variant, model)
        return model
      }
    }

    return null
  }

  addMesh(data) {
    if (!data?.blocks?.length) return false
    
    const { x, z, blocks } = data
    const blocksByType = new Map()
    let meshesAdded = 0
    
    // Group blocks by type
    for (const block of blocks) {
      if (!block?.position || block.type === 0) continue
      if (!blocksByType.has(block.type)) {
        blocksByType.set(block.type, [])
      }
      blocksByType.get(block.type).push(block)
    }

    // Process each type
    for (const [blockType, typeBlocks] of blocksByType) {
      if (this.addMeshForBlockType(blockType, typeBlocks, x, z)) {
        meshesAdded++
      }
    }

    return meshesAdded > 0
  }

  addMeshToScene(meshId, mesh) {
    if (this.meshes.has(meshId)) {
      const oldMesh = this.meshes.get(meshId)
      this.scene.remove(oldMesh)
      oldMesh.geometry?.dispose()
      oldMesh.material?.dispose()
    }
    this.meshes.set(meshId, mesh)
    this.scene.add(mesh)
  }

  addLanternMesh(block, blocks, chunkX, chunkZ) {
    try {
      const model = this.modelLoader.getModel('lantern')
      if (!model) {
        console.warn('No model found for lantern')
        return false
      }

      // Create geometry from model elements
      const elementGeometries = model.elements.map(element => {
        if (!element.from || !element.to) {
          console.warn('Invalid lantern element:', element)
          return null
        }

        const geometry = this.createElementGeometry(element)
        if (!geometry) return null
        return geometry
      }).filter(Boolean)

      if (elementGeometries.length === 0) {
        console.warn('No valid geometries for lantern')
        return false
      }

      // Merge all element geometries
      const geometry = mergeGeometries(elementGeometries)
      elementGeometries.forEach(g => g.dispose())

      // Create material with lantern texture
      const material = this.createMaterial(block.type, model)
      if (!material) {
        console.warn('Failed to create lantern material')
        return false
      }

      // Create instanced mesh
      const instancedMesh = new THREE.InstancedMesh(
        geometry,
        material,
        blocks.length
      )

      instancedMesh.name = `${block.name}_mesh_${chunkX}_${chunkZ}`

      // Position instances
      const matrix = new THREE.Matrix4()
      blocks.forEach((block, index) => {
        matrix.setPosition(
          chunkX * 16 + block.position[0],
          block.position[1],
          chunkZ * 16 + block.position[2]
        )
        instancedMesh.setMatrixAt(index, matrix)
      })

      // Add to scene
      const meshId = `${chunkX},${chunkZ},${block.type}`
      this.addMeshToScene(meshId, instancedMesh)

      return true
    } catch (error) {
      console.error('Failed to create lantern mesh:', error)
      return false
    }
  }

  addGlassPaneMesh(block, blocks, chunkX, chunkZ) {
    try {
      // Get models for different parts
      const postModel = this.modelLoader.getModel(`glass_pane_post`)
      const sideModel = this.modelLoader.getModel(`glass_pane_side`)
      
      if (!postModel || !sideModel) {
        console.warn('Missing models for glass pane')
        return false
      }

      // Create material from the model with textures
      const material = new THREE.MeshStandardMaterial({
        name: block.name,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.0,
        metalness: 0.0,
        alphaTest: 0.1
      })

      // Apply textures
      if (postModel.textures && this.atlas) {
        // Get pane texture
        const paneKey = postModel.textures.pane.replace('minecraft:block/', '')
        const paneUvs = this.uvMapping[paneKey]
        
        if (paneUvs) {
          const texture = this.atlas.clone()
          texture.repeat.set(paneUvs.width, paneUvs.height)
          texture.offset.set(paneUvs.x, paneUvs.y)
          texture.magFilter = THREE.NearestFilter
          texture.minFilter = THREE.NearestFilter
          texture.needsUpdate = true
          
          material.map = texture
          material.needsUpdate = true
        }
      }

      // Create geometries
      const postGeometry = this.createGeometryFromModel(postModel)
      const sideGeometry = this.createGeometryFromModel(sideModel)

      // For each pane, create combined geometry
      const paneGeometries = blocks.map(block => {
        const geos = []
        
        // Add center post
        geos.push(postGeometry.clone())

        // Add sides (in future, check neighbors)
        for (let rot = 0; rot < Math.PI * 2; rot += Math.PI/2) {
          const side = sideGeometry.clone()
          side.rotateY(rot)
          geos.push(side)
        }

        // Merge geometries
        return mergeGeometries(geos)
      })

      // Create instanced mesh
      const instancedMesh = new THREE.InstancedMesh(
        paneGeometries[0],
        material,
        blocks.length
      )

      instancedMesh.name = `${block.name}_mesh_${chunkX}_${chunkZ}`

      // Position instances
      const matrix = new THREE.Matrix4()
      blocks.forEach((block, index) => {
        matrix.setPosition(
          chunkX * 16 + block.position[0],
          block.position[1],
          chunkZ * 16 + block.position[2]
        )
        instancedMesh.setMatrixAt(index, matrix)
      })

      // Add to scene
      const meshId = `${chunkX},${chunkZ},${block.type}`
      this.addMeshToScene(meshId, instancedMesh)

      // Cleanup
      paneGeometries.forEach(geo => geo.dispose())
      postGeometry.dispose()
      sideGeometry.dispose()

      return true
    } catch (error) {
      console.error('Failed to create glass pane mesh:', error)
      return false
    }
  }

  createElementGeometry(element) {
    try {
      const from = element.from.map(v => v / 16)
      const to = element.to.map(v => v / 16)

      const size = {
        x: Math.abs(to[0] - from[0]),
        y: Math.abs(to[1] - from[1]),
        z: Math.abs(to[2] - from[2])
      }

      const center = {
        x: from[0] + size.x / 2 - 0.5,
        y: from[1] + size.y / 2 - 0.5,
        z: from[2] + size.z / 2 - 0.5
      }

      const geometry = new THREE.BoxGeometry(size.x, size.y, size.z)
      geometry.translate(center.x, center.y, center.z)

      if (element.rotation) {
        const origin = element.rotation.origin.map(v => v / 16 - 0.5)
        const angle = (element.rotation.angle * Math.PI) / 180

        geometry.translate(-origin[0], -origin[1], -origin[2])
        
        switch (element.rotation.axis) {
          case 'x': geometry.rotateX(angle); break
          case 'y': geometry.rotateY(angle); break
          case 'z': geometry.rotateZ(angle); break
        }

        geometry.translate(origin[0], origin[1], origin[2])
      }

      return geometry
    } catch (error) {
      console.error('Failed to create element geometry:', error)
      return null
    }
  }

  addMeshForBlockType(blockType, blocks, chunkX, chunkZ) {
    const block = this.mcData.blocks[blockType]
    if (!block) {
      console.warn(`Unknown block type: ${blockType}`)
      return false
    }

    try {
      // Special handling for glass panes and lanterns
      if (block.name.includes('glass_pane')) {
        return this.addGlassPaneMesh(block, blocks, chunkX, chunkZ)
      } else if (block.name === 'lantern') {
        return this.addLanternMesh(block, blocks, chunkX, chunkZ)
      }

      // Regular block handling
      const model = this.modelLoader.getModel(block.name)
      if (!model) {
        console.warn(`No model found for ${block.name}`)
        return false
      }

      let geometry = this.geometryCache.get(block.name)
      if (!geometry) {
        geometry = this.createGeometryFromModel(model)
        this.geometryCache.set(block.name, geometry)
      }

      const material = this.createMaterial(blockType, model)

      const instancedMesh = new THREE.InstancedMesh(
        geometry,
        material,
        blocks.length
      )

      instancedMesh.name = `${block.name}_mesh_${chunkX}_${chunkZ}`

      const matrix = new THREE.Matrix4()
      blocks.forEach((block, index) => {
        matrix.setPosition(
          chunkX * 16 + block.position[0],
          block.position[1],
          chunkZ * 16 + block.position[2]
        )
        instancedMesh.setMatrixAt(index, matrix)
      })

      const meshId = `${chunkX},${chunkZ},${blockType}`
      this.addMeshToScene(meshId, instancedMesh)

      return true
    } catch (error) {
      console.error(`Failed to create mesh for ${block.name}:`, error)
      return false
    }
  }

  addMesh(data) {
    if (!data?.blocks?.length) return false
    
    const { x, z, blocks } = data
    const blocksByType = new Map()
    let addedAnyMesh = false
    
    // Group blocks by type
    for (const block of blocks) {
      if (!block?.position || block.type === 0) continue
      if (!blocksByType.has(block.type)) {
        blocksByType.set(block.type, [])
      }
      blocksByType.get(block.type).push(block)
    }

    // Process each type
    for (const [blockType, typeBlocks] of blocksByType) {
      if (this.addMeshForBlockType(blockType, typeBlocks, x, z)) {
        addedAnyMesh = true
      }
    }

    return addedAnyMesh
  }
}

export default EnhancedMockWorker