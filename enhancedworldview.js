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
    const promises = []
    try {
      const blocks = []
      const scanRange = 32
      
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

      // Group blocks by chunk
      const chunkBlocks = new Map()
      for (const block of blocks) {
        const key = `${block.chunkX},${block.chunkZ}`
        if (!chunkBlocks.has(key)) {
          chunkBlocks.set(key, [])
        }
        chunkBlocks.get(key).push(block)
      }

      // Create meshes for each chunk
      for (const [key, chunkBlockList] of chunkBlocks) {
        const [chunkX, chunkZ] = key.split(',').map(Number)
        
        promises.push(
          new Promise((resolve) => {
            this.worker.postMessage({
              type: 'add_mesh',
              x: chunkX,
              z: chunkZ,
              blocks: chunkBlockList
            })
            resolve()
          })
        )
      }

    } catch (e) {
      console.warn(`Failed to process chunks:`, e)
    }
    
    await Promise.all(promises)
    return promises.length
  }
}

export default EnhancedWorldView