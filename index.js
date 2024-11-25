import * as THREE from 'three'
import { createCanvas, ImageData } from 'canvas'
import { loadImage } from 'node-canvas-webgl/lib/index.js'
import gl from 'gl'
import { promises as fs } from 'fs'
import { Vec3 } from 'vec3'
import { parse, simplify } from 'prismarine-nbt'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import mcAssets from 'minecraft-assets'
import path from 'path'
import { Blob, FileReader } from 'vblob'
import EnhancedMockWorker from './enhancedmockworker.js'
import EnhancedWorldView from './enhancedworldview.js'

// Polyfills for GLTF export and canvas
global.Blob = Blob
global.FileReader = FileReader
global.ImageData = ImageData
global.Image = loadImage
global.performance = { now: () => Date.now() }

const VERSION = '1.20.2'
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
    antialias: false,
    preserveDrawingBuffer: true,
    logarithmicDepthBuffer: true,
    alpha: false
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
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
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
    const timeout = setTimeout(() => {
      reject(new Error('GLTF export timed out after 30 seconds'))
    }, 30000)

    try {
      const exporter = new GLTFExporter()
      
      exporter.parse(scene, async (result) => {
        clearTimeout(timeout)
        await fs.mkdir('./gltf_out', { recursive: true })
        await fs.writeFile(
          path.join('./gltf_out', fileName), 
          JSON.stringify(result)
        )
        resolve(fileName)
      }, 
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
      {
        binary: false,
        onlyVisible: true,
        includeCustomExtensions: true,
        trs: false,
        animations: [],
        extensionsUsed: ['KHR_materials_unlit']
      })
    } catch (error) {
      clearTimeout(timeout)
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

  // Initialize mcData with full schema support
  const mcData = mcDataModule.default(VERSION)
  
  // Load block states from minecraft-data
  const states = {}
  
  // Map each block to its possible states
  for (const blockId in mcData.blocks) {
    const block = mcData.blocks[blockId]
    if (!block) continue

    // Create state entry for each block
    states[block.id] = {
      name: block.name,
      properties: block.variations ? block.variations.reduce((acc, variant) => {
        acc[variant.displayName] = variant.metadata
        return acc
      }, {}) : {},
      variants: {
        "normal": {
          model: {
            textures: {
              all: `block/${block.name}`
            }
          }
        }
      },
      default: "normal"
    }

    // Handle blocks with specific faces
    const faces = ['up', 'down', 'north', 'south', 'east', 'west']
    if (block.transparent) {
      states[block.id].variants.normal.model.textures = faces.reduce((acc, face) => {
        acc[face] = `block/${block.name}`
        return acc
      }, {})
    }
  }

  // Create an enhanced mcData object with block states
  const enhancedMcData = {
    ...mcData,
    blockStates: states
  }

  return {
    World: worldModule.default(VERSION),
    Chunk: chunkModule.default(VERSION),
    Block: blockModule.default(VERSION),
    mcData: enhancedMcData
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

const createTextureAtlas = async (assets) => {
  try {
    // Load block and item textures
    const [blockTexturesData, itemTexturesData] = await Promise.all([
      fs.readFile(path.join(assets.directory, 'blocks_textures.json'), 'utf8').then(JSON.parse),
      fs.readFile(path.join(assets.directory, 'items_textures.json'), 'utf8').then(JSON.parse)
    ])

    const ATLAS_SIZE = 2048
    const TEXTURE_SIZE = 16
    
    const atlasCanvas = createCanvas(ATLAS_SIZE, ATLAS_SIZE)
    const ctx = atlasCanvas.getContext('2d')
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)

    console.log('Sample texture entries:', {
      blocks: blockTexturesData.slice(0, 3).map(entry => ({
        name: entry.name,
        texture: entry.texture,
        model: entry.model
      })),
      items: itemTexturesData.slice(0, 3).map(entry => ({
        name: entry.name,
        texture: entry.texture,
        model: entry.model
      }))
    })

    const uvMapping = {}
    let x = 0
    let y = 0
    let processedCount = 0

    const allTextures = [...blockTexturesData, ...itemTexturesData]

    for (const entry of allTextures) {
      try {
        if (!entry.texture || entry.texture === 'null' || entry.name === 'air') {
          continue
        }

        // Clean up names and paths
        const name = entry.name.replace('minecraft:', '')
        const texture = entry.texture.replace('minecraft:', '')
        let texturePath

        if (texture.includes('entity/')) {
          // Entity textures are directly in version directory
          texturePath = path.join(assets.directory, texture + '.png')
        } else if (texture.startsWith('item/') || texture.startsWith('items/')) {
          // Handle item textures
          const itemName = texture.replace('item/', '').replace('items/', '')
          texturePath = path.join(assets.directory, 'items', `${itemName}.png`)
        } else {
          // Handle block textures
          const blockName = texture.replace('block/', '').replace('blocks/', '')
          texturePath = path.join(assets.directory, 'blocks', `${blockName}.png`)
        }

        try {
          const image = await loadImage(texturePath)
          ctx.drawImage(image, x, y, TEXTURE_SIZE, TEXTURE_SIZE)

          const mappingData = {
            x: x / ATLAS_SIZE,
            y: y / ATLAS_SIZE,
            width: TEXTURE_SIZE / ATLAS_SIZE,
            height: TEXTURE_SIZE / ATLAS_SIZE
          }

          // Store multiple variations of the name for better lookup
          const mappings = new Set([
            name,                                    // raw name
            texture,                                 // full texture path
            texture.split('/').pop(),                // texture name without path
            `block/${name}`,                         // block prefixed
            name.replace('block/', ''),              // clean block name
            texture.replace('block/', '')            // clean texture name
          ])

          // Add variants for blocks
          if (!texture.includes('item/') && !texture.includes('entity/')) {
            mappings.add(`minecraft:block/${name}`)
            mappings.add(`minecraft:blocks/${name}`)
          }

          // Store all mappings
          for (const mapping of mappings) {
            uvMapping[mapping] = mappingData
          }

          x += TEXTURE_SIZE
          if (x + TEXTURE_SIZE > ATLAS_SIZE) {
            x = 0
            y += TEXTURE_SIZE
            if (y + TEXTURE_SIZE > ATLAS_SIZE) {
              console.warn('Atlas size exceeded')
              break
            }
          }

          processedCount++

        } catch (error) {
          console.warn(`Failed to load texture for ${name} at ${texturePath}`)
          // Log the full attempted path for debugging
          console.log('Attempted path:', path.resolve(texturePath))
        }
      } catch (error) {
        console.warn('Failed to process texture entry:', error)
      }
    }

    // Debug output for specific blocks
    const blocksToCheck = ['granite', 'stone_bricks', 'oak_planks', 'glass_pane', 'dirt', 
                          'dark_oak_stairs', 'grass_block', 'lantern', 'crafting_table', 
                          'furnace', 'red_bed']
    
    console.log('Checking problematic blocks:', blocksToCheck.map(name => ({
      name,
      hasMapping: name in uvMapping,
      mappingVariants: Object.keys(uvMapping).filter(key => 
        key.includes(name) || key.endsWith(`/${name}`)
      )
    })))

    console.log('Texture processing complete:', {
      processedCount,
      mappingCount: Object.keys(uvMapping).length
    })

    // Create Three.js texture
    const textureAtlas = new THREE.CanvasTexture(atlasCanvas)
    textureAtlas.magFilter = THREE.NearestFilter
    textureAtlas.minFilter = THREE.NearestFilter
    textureAtlas.generateMipmaps = false
    textureAtlas.anisotropy = 1
    textureAtlas.flipY = false
    textureAtlas.needsUpdate = true

    textureAtlas.userData = {
      uvMapping,
      textureSize: TEXTURE_SIZE,
      atlasSize: { width: ATLAS_SIZE, height: ATLAS_SIZE }
    }

    return {
      atlas: textureAtlas,
      uvMapping,
      textureSize: TEXTURE_SIZE
    }

  } catch (error) {
    console.error('Error in texture atlas creation:', error)
    throw error
  }
}

console.log('Starting application...')

const main = async () => {
  try {
    setupGlobalEnv() // start environment
    
    const renderer = initRenderer() // initialize rendering
    
    console.log('Initializing Minecraft modules...')
    const mcModules = await initMinecraftModules()
    
    const viewer = {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(75, VIEWPORT.width / VIEWPORT.height, 0.1, 1000),
      renderer: renderer,
      world: {
        blockStates: mcModules.mcData.blockStates,
        material: new THREE.MeshStandardMaterial({
          roughness: 1.0,
          metalness: 0.0,
          transparent: true,
          alphaTest: 0.1
        })
      },
      setVersion: async (version) => {
        console.log('Setting version:', version)
        return true
      },
      listen: (worldView) => {
      }
    }

    if (!await viewer.setVersion(VERSION)) {
      throw new Error('Failed to set version')
    }

    console.log('Reading NBT file...')
    const buffer = await fs.readFile('./public/my_awesome_house.nbt')

    // Load Minecraft assets
    const assets = mcAssets(VERSION)
    const { atlas, uvMapping, textureSize } = await createTextureAtlas(assets)
    const { world, size } = await processNBT(buffer, mcModules)
    console.log('NBT data processed. Structure size:', size)
    
    const center = new Vec3(
      Math.floor(size.x / 2),
      Math.floor(size.y / 2),
      Math.floor(size.z / 2)
    )
    setupScene(viewer, size)
    
    const worldView = new EnhancedWorldView(
      world,
      VIEWPORT.viewDistance,
      center,
      viewer.scene,
      mcModules.mcData
    )

    console.log('Initializing worker...')
    await worldView.worker.initialize(assets.directory)
    worldView.worker.setAtlas(atlas, uvMapping)

    console.log('Worker initialized with atlas data:', {
      hasAtlas: !!atlas,
      mappingCount: Object.keys(uvMapping).length
    })

    await worldView.init(center)
    viewer.listen(worldView)
      
    console.log('Generating meshes...')
    const meshCount = await worldView.generateMeshes()
    console.log('Meshes generated:', meshCount)
    
    await new Promise(resolve => setTimeout(resolve, 5000))
    
    // Render and export
    const fileName = `structure_${Date.now()}.gltf`
    
    try {
      renderer.render(viewer.scene, viewer.camera)
      console.log('Render complete')
      
      await exportGLTF(viewer.scene, fileName)
      console.log(`Successfully exported to: ./gltf_out/${fileName}`)
      
    } catch (error) {
      console.error('Error during render/export:', error)
      throw error
    }
    
    process.exit(0)
  } catch (error) {
    console.error('Error in main:', error, {
      stack: error.stack
    })
    process.exit(1)
  }
}
main()