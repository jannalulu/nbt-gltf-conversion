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
    // Load block textures JSON as an array
    const blocksTexturesPath = path.join(assets.directory, 'blocks_textures.json')
    const textureArray = JSON.parse(await fs.readFile(blocksTexturesPath, 'utf8'))

    const ATLAS_SIZE = 2048
    const TEXTURE_SIZE = 16
    
    const atlasCanvas = createCanvas(ATLAS_SIZE, ATLAS_SIZE)
    const ctx = atlasCanvas.getContext('2d')
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)

    const uvMapping = {}
    let x = 0
    let y = 0
    let processedCount = 0

    // Process each texture entry in the array
    for (const entry of textureArray) {
      try {
        // Skip entries with no texture
        if (!entry.texture || entry.texture === 'null' || entry.name === 'air') {
          continue
        }

        const isItem = entry.texture.includes('items/')
        const baseDir = isItem ? 'items' : 'blocks'

        const texturePath = entry.texture
          .replace('minecraft:blocks/', '')
          .replace('minecraft:items/', '')
          .replace('blocks/', '')
          .replace('items/', '')

        const blockName = entry.name
        // Use the appropriate directory in the path
        const fullTexturePath = path.join(assets.directory, baseDir, `${texturePath}.png`)
        
        try {
          const image = await loadImage(fullTexturePath)
          
          // Draw texture to atlas
          ctx.drawImage(image, x, y, TEXTURE_SIZE, TEXTURE_SIZE)

          // Store UV mapping using block name
          uvMapping[blockName] = {
            x: x / ATLAS_SIZE,
            y: y / ATLAS_SIZE,
            width: TEXTURE_SIZE / ATLAS_SIZE,
            height: TEXTURE_SIZE / ATLAS_SIZE
          }

          // Move to next position
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
          console.warn(`Failed to load texture for ${blockName} at ${fullTexturePath}`)
        }
      } catch (error) {
        console.warn(`Failed to process texture entry:`, error)
      }
    }

        // Debug output for specific blocks
        const blocksToCheck = ['lantern', 'stone_bricks', 'oak_planks', 'dirt']
        console.log('Checking specific blocks:', blocksToCheck.map(name => ({
          name,
          hasMapping: name in uvMapping,
          textureInfo: textureArray.find(entry => entry.name === name),
          texturePath: textureArray.find(entry => entry.name === name)?.texture
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
    textureAtlas.flipY = false
    textureAtlas.needsUpdate = true

    // Store mapping data
    textureAtlas.userData = {
      uvMapping,
      textureSize: TEXTURE_SIZE,
      atlasSize: { width: ATLAS_SIZE, height: ATLAS_SIZE }
    }

    // Create block states
    const blockStates = {}
    for (const [blockName, uvs] of Object.entries(uvMapping)) {
      blockStates[blockName] = {
        variants: {
          "normal": {
            model: {
              textures: {
                all: blockName,
                top: blockName,
                side: blockName,
                bottom: blockName
              }
            }
          }
        },
        name: blockName
      }
    }

    return {
      atlas: textureAtlas,
      uvMapping,
      blockStates,
      textureSize: TEXTURE_SIZE
    }

  } catch (error) {
    console.error('Error in texture atlas creation:', error)
    throw error
  }
}

class BlockModelLoader {
  constructor(assetsDirectory) {
    this.assetsDirectory = assetsDirectory;
    this.modelCache = new Map();
    this.blockModels = null;
  }

  async loadBlockModels() {
    try {
      // Load block models JSON
      const modelsPath = path.join(this.assetsDirectory, 'blocks_models.json');
      const modelData = JSON.parse(await fs.readFile(modelsPath, 'utf8'));
      this.blockModels = modelData;

      // Process and cache each model
      for (const [modelName, model] of Object.entries(modelData)) {
        this.processModel(modelName, model);
      }

      console.log(`Loaded ${Object.keys(this.blockModels).length} block models`);
      return this.blockModels;
    } catch (error) {
      console.error('Error loading block models:', error);
      throw error;
    }
  }

  processModel(modelName, model) {
    // Handle parent inheritance
    if (model.parent) {
      const parentModel = this.blockModels[model.parent.replace('minecraft:block/', '')];
      if (parentModel) {
        model = this.mergeModels(parentModel, model);
      }
    }

    // Process textures
    if (model.textures) {
      model.textures = this.resolveTextureReferences(model.textures);
    }

    // Cache the processed model
    this.modelCache.set(modelName, model);
    return model;
  }

  mergeModels(parent, child) {
    const merged = { ...parent };

    // Merge textures
    if (child.textures) {
      merged.textures = { ...parent.textures, ...child.textures };
    }

    // Merge elements if present
    if (child.elements) {
      merged.elements = child.elements;
    }

    // Merge other properties
    if (child.ambientocclusion !== undefined) {
      merged.ambientocclusion = child.ambientocclusion;
    }

    return merged;
  }

  resolveTextureReferences(textures) {
    const resolved = {};
    for (const [key, value] of Object.entries(textures)) {
      if (typeof value === 'string' && value.startsWith('#')) {
        // Resolve texture reference
        const refKey = value.substring(1);
        resolved[key] = textures[refKey] || value;
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  getModel(blockName) {
    return this.modelCache.get(blockName);
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
    const { atlas, uvMapping, blockStates } = await createTextureAtlas(assets)
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

    // Initialize the worker with models
    await worldView.worker.initialize(assets.directory)
    worldView.worker.setAtlas(atlas, uvMapping, blockStates)

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