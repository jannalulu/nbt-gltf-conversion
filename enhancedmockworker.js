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

  createMaterial(blockId) {
    const block = this.mcData.blocks[blockId]
    if (!block || !this.atlas) {
      return new THREE.MeshStandardMaterial({ color: 0xFFFFFF })
    }

    // Find the texture mapping
    const blockName = block.name
    const uvs = this.uvMapping[blockName]

    if (!uvs) {
      console.warn(`No texture mapping found for ${blockName}`)
      return new THREE.MeshStandardMaterial({ color: 0xFFFFFF })
    }

    // Create material
    const material = new THREE.MeshStandardMaterial({
      map: this.atlas.clone(),
      transparent: block.transparent || false,
      opacity: block.transparent ? 0.8 : 1.0,
      alphaTest: block.transparent ? 0.1 : 0,
      side: block.transparent ? THREE.DoubleSide : THREE.FrontSide,
      roughness: 1.0,
      metalness: 0.0
    })

    // Apply UV mapping
    material.map.repeat.set(uvs.width, uvs.height)
    material.map.offset.set(uvs.x, uvs.y)
    material.map.magFilter = THREE.NearestFilter
    material.map.minFilter = THREE.NearestFilter
    material.map.needsUpdate = true

    return material
  }

  addLanternMesh(block, blocks, chunkX, chunkZ) {
    try {
      // Create lantern geometry
      const baseHeight = 0.4
      const chainHeight = 0.2
      const baseWidth = 0.4
      const chainWidth = 0.1

      // Base geometry (bottom part)
      const baseGeometry = new THREE.BoxGeometry(baseWidth, baseHeight, baseWidth)
      baseGeometry.translate(0, baseHeight/2, 0)

      // Chain geometry (top part)
      const chainGeometry = new THREE.BoxGeometry(chainWidth, chainHeight, chainWidth)
      chainGeometry.translate(0, baseHeight + chainHeight/2, 0)

      // Merge geometries
      const geometry = mergeGeometries([baseGeometry, chainGeometry])

      const material = this.createMaterial(block.type)

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

      const meshId = `${chunkX},${chunkZ},${block.type}`
      this.addMeshToScene(meshId, instancedMesh)

      return true
    } catch (error) {
      console.error('Failed to create lantern mesh:', error)
      return false
    }
  }

  addMeshForBlockType(blockType, blocks, chunkX, chunkZ) {
    const block = this.mcData.blocks[blockType]
    if (!block) {
      console.warn(`Unknown block type: ${blockType}`)
      return false
    }

    try {
      // Special handling for irregular blocks
      if (block.name === 'lantern') {
        return this.addLanternMesh(block, blocks, chunkX, chunkZ)
      }

      // Regular block handling (including glass panes)
      const geometry = new THREE.BoxGeometry(1, 1, 1)
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