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

    // Create material with proper texture mapping
    const material = new THREE.MeshStandardMaterial({
      map: this.atlas.clone(),
      transparent: block.transparent || blockName === 'lantern',
      opacity: blockName === 'glass_pane' ? 0.8 : 1.0,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      roughness: 1.0,
      metalness: 0.0
    })

    // Apply UV mapping with rotation for lanterns
    material.map.repeat.set(uvs.width, uvs.height)
    material.map.offset.set(uvs.x, uvs.y)
    material.map.magFilter = THREE.NearestFilter
    material.map.minFilter = THREE.NearestFilter
    material.map.needsUpdate = true

    return material
  }

  addMeshForBlockType(blockType, blocks, chunkX, chunkZ) {
    const block = this.mcData.blocks[blockType]
    if (!block) {
      console.warn(`Unknown block type: ${blockType}`)
      return false
    }

    try {
      // Get the model and create geometry using BlockModelRenderer
      const model = this.modelLoader.getModel(block.name, block.metadata)
      const geometry = this.modelRenderer.createGeometryFromModel(model)
      const material = this.createMaterial(blockType)

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

  addMesh(data) {
    if (!data?.blocks?.length) return false
    
    const { x, z, blocks } = data
    const blocksByType = new Map()
    let addedAnyMesh = false
    
    for (const block of blocks) {
      if (!block?.position || block.type === 0) continue
      if (!blocksByType.has(block.type)) {
        blocksByType.set(block.type, [])
      }
      blocksByType.get(block.type).push(block)
    }

    for (const [blockType, typeBlocks] of blocksByType) {
      if (this.addMeshForBlockType(blockType, typeBlocks, x, z)) {
        addedAnyMesh = true
      }
    }

    return addedAnyMesh
  }
}

export default EnhancedMockWorker