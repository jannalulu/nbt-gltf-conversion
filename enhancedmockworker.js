import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import BlockModelLoader from './blockmodelloader.js'
import BlockModelRenderer from './blockmodelrenderer.js'

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
    this.modelRenderer = new BlockModelRenderer(scene)
  }

  async initialize(assetsDirectory) {
    try {
      this.modelLoader = new BlockModelLoader(assetsDirectory)
      await this.modelLoader.loadBlockModels()
      return true
    } catch (error) {
      console.error('Worker initialization failed:', error)
      throw error
    }
  }

  setAtlas(atlas, uvMapping) {
    this.atlas = atlas
    this.uvMapping = uvMapping
  }

  createMaterial(blockId) {
    const block = this.mcData.blocks[blockId]
    if (!block || !this.atlas) {
      return new THREE.MeshStandardMaterial({ color: 0xFFFFFF })
    }

    const blockName = block.name.replace('minecraft:', '')
    
    // Try multiple texture mapping possibilities
    const textureMappings = [
      blockName,
      `block/${blockName}`,
      `minecraft:block/${blockName}`,
      `${blockName}_texture`,
      'particle'
    ]

    let uvs = null
    for (const mapping of textureMappings) {
      if (this.uvMapping[mapping]) {
        uvs = this.uvMapping[mapping]
        break
      }
    }

    if (!uvs) {
      console.warn(`No texture mapping found for ${blockName}`)
      return new THREE.MeshStandardMaterial({ color: 0xFFFFFF })
    }

    // Create base material
    const material = new THREE.MeshStandardMaterial({
      map: this.atlas.clone(),
      alphaTest: 0.1,
      side: THREE.FrontSide,
      roughness: 1.0,
      metalness: 0.0
    })

    // Apply UV mapping
    material.map.repeat.set(uvs.width, uvs.height)
    material.map.offset.set(uvs.x, uvs.y)
    material.map.magFilter = THREE.NearestFilter
    material.map.minFilter = THREE.NearestFilter
    material.map.needsUpdate = true
    material.map.anisotropy = 1

    // Special case handling
    switch(blockName) {
      case 'lantern':
        // Make lantern emit light
        material.emissive = new THREE.Color(0xffa726)  // Warm light color
        material.emissiveMap = material.map
        material.emissiveIntensity = 0.6
        // Handle transparency for the glass part
        material.transparent = true
        material.opacity = 1.0
        material.alphaTest = 0.01
        break

      case 'glass':
      case 'glass_pane':
        material.transparent = true
        material.opacity = 0.8
        break
    }

    return material
  }

  addMesh(data) {
    if (!data?.blocks?.length) return false
    
    const { x, z, blocks } = data
    const blocksByType = new Map()
    let addedAnyMesh = false
    
    for (const block of blocks) {
      if (!block?.position || block.type === 0) continue
      
      // Get block reference
      const blockRef = this.mcData.blocks[block.type]
      if (!blockRef) continue

      const blockName = blockRef.name
      if (!blocksByType.has(block.type)) {
        blocksByType.set(block.type, [])
      }

      // Preserve block properties
      const blockData = {
        position: block.position,
        type: block.type,
        name: blockName,
        properties: block.properties || {}, // Use properties directly from block
        block: block.block
      }
      blocksByType.get(block.type).push(blockData)

      // Debug log for important blocks
      if (blockName === 'minecraft:lantern' || blockName === 'minecraft:glass_pane') {
        console.log('Block data:', {
          type: blockName,
          properties: blockData.properties,
          metadata: block.block?.metadata
        })
      }
    }

    for (const [blockType, typeBlocks] of blocksByType) {
      if (this.addMeshForBlockType(blockType, typeBlocks, x, z)) {
        addedAnyMesh = true
      }
    }

    return addedAnyMesh
  }

  addMeshForBlockType(blockType, blocks, chunkX, chunkZ) {
    const block = this.mcData.blocks[blockType]
    if (!block) {
      console.warn(`Unknown block type: ${blockType}`)
      return false
    }

    try {
      // Group blocks by their properties to handle variants
      const blocksByState = new Map()
      
      for (const blockData of blocks) {
        // Combine properties and metadata
        const properties = {
          ...blockData.block?.metadata,
          ...blockData.properties
        }
        
        const stateKey = JSON.stringify(properties)
        if (!blocksByState.has(stateKey)) {
          blocksByState.set(stateKey, [])
        }
        blocksByState.get(stateKey).push({
          ...blockData,
          properties
        })
      }

      // Create mesh for each unique state
      for (const [stateKey, stateBlocks] of blocksByState) {
        const properties = JSON.parse(stateKey)
        console.log(`Creating mesh for ${block.name} with properties:`, properties)

        // Get model with properties
        const model = this.modelLoader.getModel(block.name, properties)
        if (!model) {
          console.warn(`No model found for ${block.name} with state:`, properties)
          continue
        }

        const geometry = this.modelRenderer.createGeometryFromModel(model)
        const material = this.createMaterial(blockType)
        
        // Adjust material based on block type
        if (block.name === 'minecraft:glass_pane') {
          material.transparent = true
          material.opacity = 0.8
          material.side = THREE.DoubleSide
        }

        const instancedMesh = new THREE.InstancedMesh(
          geometry,
          material,
          stateBlocks.length
        )

        instancedMesh.name = `${block.name}_${stateKey}_${chunkX}_${chunkZ}`

        const matrix = new THREE.Matrix4()
        stateBlocks.forEach((blockData, index) => {
          matrix.setPosition(
            chunkX * 16 + blockData.position[0],
            blockData.position[1],
            chunkZ * 16 + blockData.position[2]
          )
          instancedMesh.setMatrixAt(index, matrix)
        })

        const meshId = `${chunkX},${chunkZ},${blockType},${stateKey}`
        this.addMeshToScene(meshId, instancedMesh)
      }

      return true
    } catch (error) {
      console.error(`Failed to create mesh for ${block.name}:`, error)
      return false
    }
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
}

export default EnhancedMockWorker