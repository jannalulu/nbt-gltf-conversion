import { Vec3 } from 'vec3'
import EnhancedMockWorker from './enhancedmockworker.js'

class EnhancedWorldView {
  constructor(world, viewDistance, center, scene, mcData) {
    this.world = world
    this.viewDistance = viewDistance
    this.center = center
    this.scene = scene
    this.mcData = mcData
    this.isStarted = false
    this.worker = new EnhancedMockWorker(scene, mcData)
  }

  async init(pos) {
    this.center = pos
    return true
  }

  updatePosition(pos) {
    this.center = pos
  }

  async generateMeshes() {
    try {
      const blocks = []
      const scanRange = 32
      
      console.log('Scanning blocks...')
      for (let x = -scanRange; x <= scanRange; x++) {
        for (let y = 0; y < 256; y++) {
          for (let z = -scanRange; z <= scanRange; z++) {
            const worldX = this.center.x + x
            const worldY = y
            const worldZ = this.center.z + z
            
            try {
              const block = await this.world.getBlock(new Vec3(worldX, worldY, worldZ))
              if (block && block.type !== 0) {
                const localChunkX = Math.floor(worldX / 16)
                const localChunkZ = Math.floor(worldZ / 16)
                const localX = worldX - (localChunkX * 16)
                const localZ = worldZ - (localChunkZ * 16)
                
                blocks.push({
                  chunkX: localChunkX,
                  chunkZ: localChunkZ,
                  type: block.type,
                  position: [parseInt(localX), parseInt(worldY), parseInt(localZ)]
                })
              }
            } catch (e) {
              continue
            }
          }
        }
      }

      console.log(`Found ${blocks.length} blocks to process`)

      // Group blocks by chunk
      const chunkBlocks = new Map()
      for (const block of blocks) {
        const key = `${block.chunkX},${block.chunkZ}`
        if (!chunkBlocks.has(key)) {
          chunkBlocks.set(key, [])
        }
        chunkBlocks.get(key).push(block)
      }

      console.log(`Grouped into ${chunkBlocks.size} chunks`)

      // Process each chunk
      let meshCount = 0
      for (const [key, chunkBlockList] of chunkBlocks) {
        const [chunkX, chunkZ] = key.split(',').map(Number)
        
        // Send blocks to worker
        const result = this.worker.addMesh({
          x: chunkX,
          z: chunkZ,
          blocks: chunkBlockList
        })
        
        if (result) meshCount++
      }

      console.log(`Generated ${meshCount} meshes`)
      return meshCount

    } catch (e) {
      console.error('Failed to process chunks:', e)
      throw e
    }
  }
}

export default EnhancedWorldView