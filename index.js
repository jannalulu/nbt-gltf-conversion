import * as THREE from 'three'
import { createCanvas, ImageData } from 'canvas'
import { loadImage } from 'node-canvas-webgl/lib/index.js'
import gl from 'gl'
import { promises as fs } from 'fs'
import { Vec3 } from 'vec3'
import prismarineViewer from 'prismarine-viewer'
const { viewer: PrismarineViewer } = prismarineViewer
import { parse, simplify } from 'prismarine-nbt'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import path from 'path'
import { fileURLToPath } from 'url'
import { Blob, FileReader } from 'vblob'

// Polyfill for GLTF export
global.Blob = Blob
global.FileReader = FileReader 

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const VERSION = '1.20.1'
const VIEWPORT = {
  width: 1024,
  height: 1024,
  viewDistance: 8,
  center: new Vec3(0, 0, 0),
}

// Mock implementations
const createMockCanvas = (width, height) => {
  const canvas = createCanvas(width, height)
  canvas.addEventListener = () => {}
  canvas.removeEventListener = () => {}
  canvas.clientWidth = width
  canvas.clientHeight = height
  canvas.setAttribute = () => {}
  canvas.getAttribute = () => null
  canvas.style = { width: `${width}px`, height: `${height}px` }
  canvas.getBoundingClientRect = () => ({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height
  })
  canvas.parentElement = {
    appendChild: () => {},
    removeChild: () => {},
    style: {}
  }
  canvas.ownerDocument = {
    defaultView: {
      innerWidth: width,
      innerHeight: height,
      devicePixelRatio: 1,
      addEventListener: () => {},
      removeEventListener: () => {},
      navigator: { userAgent: 'node' },
      getComputedStyle: () => ({
        getPropertyValue: () => ''
      }),
      requestAnimationFrame: (callback) => setTimeout(callback, 16),
      cancelAnimationFrame: (id) => clearTimeout(id),
      location: { href: '' }
    }
  }
  
  // Add WebGL context methods
  const context = canvas.getContext('webgl2')
  canvas.getContext = (type) => {
    if (type === 'webgl2' || type === 'webgl') {
      return context
    }
    return null
  }
  
  return canvas
}

class EnhancedMockWorker {
  constructor(scene, mcData) {
    this.onmessage = null
    this.messageQueue = []
    this.processingQueue = false
    this.scene = scene
    this.mcData = mcData
    this.meshes = new Map()
  }

  getBlockColor(blockId) {
    const colors = {
      stone: 0x808080,
      dirt: 0x8B4513,
      grass_block: 0x567D46,
      wood: 0x8B4513,
      planks: 0xDEB887,
      glass: 0xADD8E6,
      default: 0xAAAAAA
    }
    
    const block = this.mcData.blocks[blockId]
    return colors[block?.name] || colors.default
  }

  async processMessage(data) {
    if (data.type === 'add_mesh') {
      const { x, z, blocks } = data
      
      for (const block of blocks) {
        if (block.type === 0) continue // Skip air blocks
        
        const geometry = new THREE.BoxGeometry(1, 1, 1)
        const material = new THREE.MeshStandardMaterial({ 
          color: this.getBlockColor(block.type),
          roughness: 0.8,
          metalness: 0.2
        })
        
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(
          x * 16 + block.position[0],
          block.position[1],
          z * 16 + block.position[2]
        )
        
        mesh.castShadow = true
        mesh.receiveShadow = true
        
        const key = `${x},${block.position[1]},${z},${block.position.join(',')}`
        this.meshes.set(key, mesh)
        this.scene.add(mesh)
      }
    }
  }

  postMessage(data) {
    this.messageQueue.push(data)
    if (!this.processingQueue) {
      this.processingQueue = true
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift()
        this.processMessage(message)
      }
      this.processingQueue = false
    }
  }

  terminate() {
    this.meshes.forEach(mesh => {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
    this.meshes.clear()
  }
}

// Setup global environment
const setupGlobalEnv = () => {
  global.Worker = EnhancedMockWorker
  global.THREE = THREE
  
  // Basic window mock
  global.window = {
    innerWidth: VIEWPORT.width,
    innerHeight: VIEWPORT.height,
    devicePixelRatio: 1
  }
  
  // Basic document mock for canvas
  global.document = {
    createElement: (type) => {
      if (type === 'canvas') return createCanvas(VIEWPORT.width, VIEWPORT.height)
      throw new Error(`Cannot create node ${type}`)
    }
  }
}

// Enhanced world view implementation
class EnhancedWorldView extends PrismarineViewer.WorldView {
  constructor(world, viewDistance, center, scene, mcData) {
    super(world, viewDistance, center)
    this.worker = new EnhancedMockWorker(scene, mcData)
    this.center = center
  }

  async generateMeshes() {
    const promises = []

    // Get blocks from the current chunk
    const chunkX = Math.floor(this.center.x / 16)
    const chunkZ = Math.floor(this.center.z / 16)

    try {
      const blocks = []
      
      // Scan a reasonable volume around the center
      const scanRange = 32 // Adjust this value based on your needs
      
      for (let x = -scanRange; x <= scanRange; x++) {
        for (let y = 0; y < 256; y++) {
          for (let z = -scanRange; z <= scanRange; z++) {
            const worldX = this.center.x + x
            const worldY = y
            const worldZ = this.center.z + z
            
            try {
              const block = await this.world.getBlock(new Vec3(worldX, worldY, worldZ))
              if (block && block.type !== 0) { // Skip air blocks
                const localChunkX = Math.floor(worldX / 16)
                const localChunkZ = Math.floor(worldZ / 16)
                const localX = worldX - (localChunkX * 16)
                const localZ = worldZ - (localChunkZ * 16)
                
                blocks.push({
                  chunkX: localChunkX,
                  chunkZ: localChunkZ,
                  type: block.type,
                  position: [localX, worldY, localZ]
                })
              }
            } catch (e) {
              // Skip individual block errors
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
              y: 0, // We'll handle Y position in the block positions
              z: chunkZ,
              blocks: chunkBlockList.map(block => ({
                type: block.type,
                position: block.position
              }))
            })
            resolve()
          })
        )
      }

    } catch (e) {
      console.warn(`Failed to process chunks around ${chunkX}, ${chunkZ}:`, e.message)
    }
    
    await Promise.all(promises)
    return promises.length
  }
}

// Initialize renderer
const initRenderer = () => {
  const canvas = createMockCanvas(VIEWPORT.width, VIEWPORT.height)
  const glContext = gl(VIEWPORT.width, VIEWPORT.height, {
    preserveDrawingBuffer: true,
    antialias: true,
  })

  const renderer = new THREE.WebGLRenderer({
    canvas,
    context: glContext,
    antialias: true,
    preserveDrawingBuffer: true,
  })

  renderer.setSize(VIEWPORT.width, VIEWPORT.height)
  renderer.setPixelRatio(1)
  renderer.shadowMap.enabled = true
  renderer.outputColorSpace = THREE.SRGBColorSpace
  return renderer
}

// Setup scene
const setupScene = (viewer, size) => {
  viewer.scene.background = new THREE.Color('#87CEEB')
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  viewer.scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(size.x, size.y * 1.5, size.z)
  directionalLight.castShadow = true
  
  directionalLight.shadow.mapSize.width = 2048
  directionalLight.shadow.mapSize.height = 2048
  directionalLight.shadow.camera.near = 0.1
  directionalLight.shadow.camera.far = 500
  
  viewer.scene.add(directionalLight)

  const maxDimension = Math.max(size.x, size.y, size.z)
  const cameraDistance = maxDimension * 2
  viewer.camera.position.set(
    size.x / 2 + cameraDistance,
    size.y / 2 + cameraDistance / 2,
    size.z / 2 + cameraDistance
  )
  viewer.camera.lookAt(size.x / 2, size.y / 2, size.z / 2)

  return viewer
}

// Export GLTF
const exportGLTF = (scene, fileName) => {
  return new Promise((resolve, reject) => {
    try {
      const exporter = new GLTFExporter()
      
      exporter.parse(scene, async (result) => {
        await fs.mkdir('./gltf_out', { recursive: true })
        await fs.writeFile(
          path.join('./gltf_out', fileName), 
          JSON.stringify(result)
        )
        resolve(fileName)
      }, 
      (error) => reject(error),
      {
        binary: false,
        onlyVisible: true,
        includeCustomExtensions: true
      })
    } catch (error) {
      reject(error)
    }
  })
}


// Initialize Minecraft modules
const initMinecraftModules = async () => {
  const [worldModule, chunkModule, blockModule, mcDataModule] = await Promise.all([
    import('prismarine-world'),
    import('prismarine-chunk'),
    import('prismarine-block'),
    import('minecraft-data')
  ])

  return {
    World: worldModule.default(VERSION),
    Chunk: chunkModule.default(VERSION),
    Block: blockModule.default(VERSION),
    mcData: mcDataModule.default(VERSION)
  }
}

// Process NBT
const processNBT = async (buffer, { World, Chunk, Block, mcData }) => {
  const world = new World(() => {
    const chunk = new Chunk()
    chunk.initialize(() => null)
    return chunk
  })
  
  const { parsed } = await parse(buffer)
  
  const size = {
    x: parsed.value.size.value.value[0],
    y: parsed.value.size.value.value[1],
    z: parsed.value.size.value.value[2],
  }
  
  VIEWPORT.center = new Vec3(
    Math.floor(size.x / 2),
    Math.floor(size.y / 2),
    Math.floor(size.z / 2)
  )

  const palette = parsed.value.palette.value.value.map(block => ({
    type: block.Name.value,
    properties: block.Properties ? simplify(block.Properties) : {},
  }))

  // Group blocks by chunk
  const chunkBlocks = new Map()
  for (const block of parsed.value.blocks.value.value) {
    const { type, properties } = palette[block.state.value]
    if (type === 'minecraft:air') continue

    const blockName = type.split(':')[1]
    const blockRef = mcData.blocksByName[blockName]
    if (!blockRef) continue

    const [x, y, z] = block.pos.value.value
    const chunkX = Math.floor(x / 16)
    const chunkZ = Math.floor(z / 16)
    const chunkKey = `${chunkX},${chunkZ}`
    
    if (!chunkBlocks.has(chunkKey)) {
      chunkBlocks.set(chunkKey, [])
    }
    
    chunkBlocks.get(chunkKey).push({
      position: new Vec3(x, y, z),
      block: Block.fromProperties(blockRef.id, properties, 1)
    })
  }

  // Set blocks chunk by chunk
  for (const [key, blocks] of chunkBlocks) {
    const [chunkX, chunkZ] = key.split(',').map(Number)
    const chunk = new Chunk()
    chunk.initialize(() => null)
    
    for (const { position, block } of blocks) {
      const localX = position.x % 16
      const localZ = position.z % 16
      chunk.setBlock(new Vec3(localX, position.y, localZ), block)
    }
    
    await world.setColumn(chunkX, chunkZ, chunk)
  }

  return { world, size }
}
const main = async () => {
  try {
    console.log('Setting up environment...')
    setupGlobalEnv()
    const renderer = initRenderer()
    
    console.log('Initializing Minecraft modules...')
    const mcModules = await initMinecraftModules()
    
    console.log('Creating viewer...')
    const viewer = new PrismarineViewer.Viewer(renderer, false)
    await viewer.setVersion(VERSION)
    
    console.log('Reading NBT file...')
    const buffer = await fs.readFile('./public/my_awesome_house.nbt')
    const { world, size } = await processNBT(buffer, mcModules)
    
    // Calculate the center based on the size
    const center = new Vec3(
      Math.floor(size.x / 2),
      Math.floor(size.y / 2),
      Math.floor(size.z / 2)
    )
    
    console.log('Setting up scene...')
    setupScene(viewer, size)
    
    console.log('Setting up world view...')
    const worldView = new EnhancedWorldView(
      world,
      VIEWPORT.viewDistance,
      center,
      viewer.scene,
      mcModules.mcData
    )
    await worldView.init(center)
    viewer.listen(worldView)
    
    console.log('Generating meshes...')
    const meshCount = await worldView.generateMeshes()
    console.log(`Generated ${meshCount} meshes`)
    
    // Give time for all meshes to be added to the scene
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Render the scene
    renderer.render(viewer.scene, viewer.camera)
    
    console.log('Exporting to GLTF...')
    const fileName = `minecraft_structure_${Date.now()}.gltf`
    await exportGLTF(viewer.scene, fileName)
    
    console.log(`Successfully exported to: ./gltf_out/${fileName}`)
    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    console.error(error.stack)
    process.exit(1)
  }
}
main()