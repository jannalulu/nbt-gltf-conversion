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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const VERSION = '1.20.1'
const VIEWPORT = {
  width: 1024,
  height: 1024,
  viewDistance: 8,
  center: new Vec3(0, 0, 0),
}

// Use Node's worker_threads for proper worker functionality
import { Worker } from 'worker_threads'

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
    defaultView: global.window
  }
  return canvas
}

const setupGlobalEnv = () => {
  global.Worker = MockWorker
  global.window = {
    innerWidth: VIEWPORT.width,
    innerHeight: VIEWPORT.height,
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    navigator: { userAgent: 'node' },
    getComputedStyle: () => ({
      getPropertyValue: () => ''
    }),
    requestAnimationFrame: () => {},
    location: { href: '' }
  }
  global.loadImage = loadImage
  global.THREE = THREE
  global.ImageData = ImageData
  global.document = {
    createElement: (type) => {
      if (type !== 'canvas') throw new Error(`Cannot create node ${type}`)
      return createMockCanvas(VIEWPORT.width, VIEWPORT.height)
    },
    createElementNS: (ns, element) => document.createElement(element),
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: {
      style: {}
    }
  }
}

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
  // Updated from outputEncoding to outputColorSpace
  renderer.outputColorSpace = THREE.SRGBColorSpace
  return renderer
}

const initMinecraftModules = async () => {
  const [worldModule, chunkModule, blockModule, mcDataModule] = await Promise.all([
    import('prismarine-world'),
    import('prismarine-chunk'),
    import('prismarine-block'),
    import('minecraft-data'),
  ])

  return {
    World: worldModule.default(VERSION),
    Chunk: chunkModule.default(VERSION),
    Block: blockModule.default(VERSION),
    mcData: mcDataModule.default(VERSION),
  }
}

const processNBT = async (buffer, { World, Chunk, Block, mcData }) => {
  // Initialize world with chunk boundaries aligned to structure size
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
    properties: block.Properties ? convertToDataType(simplify(block.Properties)) : {},
  }))

  for (const block of parsed.value.blocks.value.value) {
    const { type, properties } = palette[block.state.value]
    if (type === 'minecraft:air') continue

    const blockName = type.split(':')[1]
    const blockRef = mcData.blocksByName[blockName]
    if (!blockRef) continue

    const [x, y, z] = block.pos.value.value
    await world.setBlock(
      new Vec3(x, y, z),
      Block.fromProperties(blockRef.id, properties, 1)
    )
  }

  return { world, size }
}

const convertToDataType = (properties) => {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      !isNaN(value) ? parseInt(value) :
      value === 'true' ? true :
      value === 'false' ? false :
      value
    ])
  )
}

const setupScene = (viewer, size) => {
  // Create scene background using Color constructor
  viewer.scene.background = new THREE.Color('#87CEEB')
  
  // Add lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  viewer.scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(size.x, size.y * 1.5, size.z)
  directionalLight.castShadow = true
  
  // Set up shadow properties
  directionalLight.shadow.mapSize.width = 2048
  directionalLight.shadow.mapSize.height = 2048
  directionalLight.shadow.camera.near = 0.1
  directionalLight.shadow.camera.far = 500
  
  viewer.scene.add(directionalLight)

  // Position camera
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

const exportGLTF = (scene, fileName) => {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()
    const options = {
      binary: false,
      onlyVisible: true,
      maxTextureSize: 4096,
      embedImages: true,
      includeCustomExtensions: true,
    }

    exporter.parse(
      scene,
      async (gltf) => {
        try {
          await fs.mkdir('./gltf_out', { recursive: true })
          await fs.writeFile(
            path.join('./gltf_out', fileName),
            JSON.stringify(gltf, null, 2)
          )
          resolve(fileName)
        } catch (error) {
          reject(error)
        }
      },
      (error) => reject(error),
      options
    )
  })
}

const generateRandomString = (length) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('')
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
    const success = await viewer.setVersion(VERSION)
    if (!success) {
      throw new Error('Failed to set version - block states may not be loaded')
    }
    console.log('Version set successfully, block states loaded')
    
    // Wait for textures and block states to fully load
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Debug texture loading
    if (!viewer.world || !viewer.world.material || !viewer.world.material.map) {
      console.log('Warning: Textures not loaded properly')
    } else {
      console.log('Textures loaded successfully')
    }

    console.log('Reading NBT file...')
    const buffer = await fs.readFile('./public/my_awesome_house.nbt')
    const { parsed } = await parse(buffer)
    const { world, size } = await processNBT(buffer, mcModules)
    
    // Debug block loading
    console.log('Structure size:', size)
    const blockCount = parsed.value.blocks.value.value.length
    console.log('Total blocks in NBT:', blockCount)

    console.log('Setting up world view...')
    const worldView = new PrismarineViewer.WorldView(
      world,
      VIEWPORT.viewDistance,
      VIEWPORT.center
    )
    await worldView.init(VIEWPORT.center)
    viewer.listen(worldView)
    
    // Debug world loading
    console.log('World center:', VIEWPORT.center)
    console.log('Loaded chunks:', Object.keys(worldView.loadedChunks).length)
    console.log('World view chunks:', Object.keys(worldView.world.columns).length)

    console.log('Waiting for chunks and textures...')
    await worldView.updatePosition(VIEWPORT.center, true) // Force update
    await viewer.waitForChunksToRender()
    await worldView.updatePosition(VIEWPORT.center, true) // Second update to ensure chunks are loaded
    
    // Wait for worker to generate meshes
    console.log('Waiting for mesh generation...')
    console.log('Viewer world:', !!viewer.world)
    console.log('Section meshes:', viewer.world ? Object.keys(viewer.world.sectionMeshs).length : 0)
    console.log('Worker state:', viewer.world ? !!viewer.world.worker : false)
    await new Promise(resolve => setTimeout(resolve, 3000))
    await viewer.world.waitForChunksToRender()
    
    // Verify meshes were generated
    const meshCount = viewer.scene.children.filter(c => c.isMesh).length
    console.log('Generated meshes:', meshCount)
    console.log('Section meshes after wait:', viewer.world ? Object.keys(viewer.world.sectionMeshs).length : 0)
    if (meshCount === 0) {
      throw new Error('No meshes were generated - check world loading and chunk rendering')
    }

    console.log('Setting up scene...')
    setupScene(viewer, size)
    renderer.render(viewer.scene, viewer.camera)

    console.log('Exporting to GLTF...');
    console.log('Scene children:', viewer.scene.children.length);
    console.log('Scene meshes:', viewer.scene.children.filter(c => c instanceof THREE.Mesh).length);

    console.log('Exporting to GLTF...')
    const fileName = `${generateRandomString(20)}.gltf`
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