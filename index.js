// Import dependencies using mixed module approaches as needed
import * as THREE from 'three'
import { createCanvas, ImageData } from 'canvas'
import { loadImage } from 'node-canvas-webgl/lib/index.js'
import gl from 'gl'
import { promises as fs } from 'fs'
import { Vec3 } from 'vec3'
import prismarineViewer from 'prismarine-viewer'
const { viewer: PrismarineViewer } = prismarineViewer
import { parse, simplify } from 'prismarine-nbt'
import express from 'express'
import fileUpload from 'express-fileupload'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fetch from 'node-fetch'

// Constants
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const VERSION = '1.20.1'
const VIEWPORT = {
  width: 800, // Increased viewport size
  height: 800,
  viewDistance: 6, // Increased view distance
  center: new Vec3(0, 0, 0), // Starting at origin
}



class MockWorker {
  constructor() {
    this.onmessage = null
    this.onerror = null
  }

  postMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data })
    }
  }

  terminate() {}
}

const initMinecraftModules = async () => {
  const worldModule = await import('prismarine-world')
  const chunkModule = await import('prismarine-chunk')
  const blockModule = await import('prismarine-block')
  const mcDataModule = await import('minecraft-data')

  const World = worldModule.default(VERSION)
  const Chunk = chunkModule.default(VERSION)
  const Block = blockModule.default(VERSION)
  const mcData = mcDataModule.default(VERSION)

  return { World, Chunk, Block, mcData }
}

const createCanvasWithEvents = (width, height) => {
  const canvas = createCanvas(width, height)
  canvas.addEventListener = () => {}
  canvas.removeEventListener = () => {}
  canvas.clientWidth = width
  canvas.clientHeight = height
  canvas.style = { width: `${width}px`, height: `${height}px` }
  canvas.setAttribute = () => {}
  canvas.getElementsByTagName = () => []
  canvas.parentElement = null
  return canvas
}

const initRenderer = () => {
  const canvas = createCanvasWithEvents(VIEWPORT.width, VIEWPORT.height)
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
  return { canvas, renderer }
}

const setupGlobalEnv = () => {
  global.Worker = MockWorker
  global.window = {
    innerWidth: VIEWPORT.width,
    innerHeight: VIEWPORT.height,
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    navigator: {
      userAgent: 'node',
    },
  }

  global.loadImage = loadImage // Move this up
  global.THREE = THREE
  global.ImageData = ImageData
  
  global.document = {
    createElement: (nodeName) => {
      if (nodeName !== 'canvas') throw new Error(`Cannot create node ${nodeName}`)
      return createCanvasWithEvents(256, 256)
    },
    createElementNS: (ns, element) => document.createElement(element),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

const initExpress = () => {
  const app = express()
  const port = process.env.PORT || 3000

  const setupDirectories = async () => {
    await fs.rm('./tmp', { recursive: true, force: true }).catch(() => {})
    await fs.rm('./gltf_out', { recursive: true, force: true }).catch(() => {})
    await fs.mkdir('./tmp', { recursive: true })
    await fs.mkdir('./gltf_out', { recursive: true })
  }

  return { app, port, setupDirectories }
}

const convertToDataType = (properties) => {
  const converted = { ...properties }
  for (const [key, value] of Object.entries(converted)) {
    if (!isNaN(value)) {
      converted[key] = parseInt(value)
    } else if (value === 'true' || value === 'false') {
      converted[key] = value === 'true'
    }
  }
  return converted
}

const generateRandomString = (length) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('')
}

const processNBT = async (buffer, { World, Chunk, Block, mcData }) => {
  const world = new World(() => {
    const chunk = new Chunk()
    return chunk
  })
  const { parsed } = await parse(buffer)

  // Get the size of the structure for centering
  const size = {
    x: parsed.value.size.value.value[0],
    y: parsed.value.size.value.value[1],
    z: parsed.value.size.value.value[2]
  }

  // Update viewport center based on structure size
  VIEWPORT.center = new Vec3(
    Math.floor(size.x / 2),
    Math.floor(size.y / 2),
    Math.floor(size.z / 2)
  )

  const rawPalette = parsed.value.palette.value.value
  const formattedPalette = rawPalette.reduce((acc, block, index) => {
    acc[index] = {
      type: block.Name.value,
      properties: block.Properties
        ? convertToDataType(simplify(block.Properties))
        : {},
    }
    return acc
  }, {})

  console.log('Processing blocks:', parsed.value.blocks.value.value.length);
  const blocks = parsed.value.blocks.value.value
  for (const block of blocks) {
    const { type, properties } = formattedPalette[block.state.value]
    console.log('Block type:', type);

    if (type !== 'minecraft:air') {
      const blockRef = mcData.blocksByName[type.split(':')[1]]
      if (blockRef) {
        const newBlock = Block.fromProperties(blockRef.id, properties, 1)
        const [x, y, z] = block.pos.value.value
        console.log(`Setting block at ${x},${y},${z}:`, blockRef.name);
        await world.setBlock(new Vec3(x, y, z), newBlock)
        // Verify block was set
        const setBlock = await world.getBlock(new Vec3(x, y, z))
        if (!setBlock) {
          throw new Error(`Failed to set block at ${x},${y},${z}`)
        }
      }
    }
  }

  return { world, size }
}

const exportToGLTF = async (scene, renderer, camera) => {
  const exporter = new GLTFExporter()
  const fileName = `${generateRandomString(20)}.gltf`

  // Remove ambient light before export
  const ambientLight = scene.children.find(child => child.type === 'AmbientLight')
  if (ambientLight) {
    scene.remove(ambientLight)
  }

  // Ensure scene is rendered before export
  renderer.render(scene, camera)
  
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (gltf) => {
        fs.writeFile(`./gltf_out/${fileName}`, JSON.stringify(gltf))
          .then(() => resolve(fileName))
          .catch(reject)
      },
      (error) => reject(error),
      { binary: false }
    )
  })
}


const setupApplication = async () => {
  // Setup environment must be first
  setupGlobalEnv();
  
  // Wait a tick to ensure globals are set
  await new Promise(resolve => setTimeout(resolve, 0));
  
  // Initialize modules
  const { renderer } = initRenderer();
  const mcModules = await initMinecraftModules();
  
  // Create viewer after environment is set up
  const viewer = new PrismarineViewer.Viewer(renderer, false);

  try {
    console.log('Reading NBT file...');
    const buffer = await fs.readFile('./public/house.nbt');
    console.log('Processing NBT data...');
    const { world, size } = await processNBT(buffer, mcModules);
    
    // Debug: Check if we have blocks
    const testPos = new Vec3(0, 0, 0);
    const block = world.getBlock(testPos);
    console.log('First block at origin:', block);
    console.log('Structure size:', size);

    console.log('Setting up viewer...');
    if (!viewer.setVersion(VERSION)) {
      throw new Error('Failed to set version')
    }
    
    // Wait for textures to load
    await new Promise((resolve) => {
      const checkTextures = () => {
        if (viewer.world.material?.map?.image) {
          console.log('Textures loaded: yes');
          resolve();
        } else {
          console.log('Waiting for textures...');
          setTimeout(checkTextures, 100);
        }
      };
      checkTextures();
    });
    
    viewer.scene.background = new THREE.Color(0x87CEEB);
    
    // Add directional light for better rendering
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 0.5).normalize();
    directionalLight.castShadow = true;
    directionalLight.target.position.set(0, 0, -1);
    directionalLight.add(directionalLight.target);
    viewer.scene.add(directionalLight);
    const worldView = new PrismarineViewer.WorldView(
      world,
      VIEWPORT.viewDistance,
      VIEWPORT.center
    );

    console.log('Initializing world view...');
    await worldView.init(VIEWPORT.center);
    viewer.listen(worldView);
    console.log('World renderer meshes:', Object.keys(viewer.world.sectionMeshs).length);
    
    // Debug: Check if worldView loaded
    console.log('World view initialized at:', VIEWPORT.center);
    console.log('View distance:', VIEWPORT.viewDistance);

    // Wait for chunks to load and render
    console.log('Loading chunks...');
    await new Promise(resolve => setTimeout(resolve, 100)); // Let chunks start loading
    await worldView.updatePosition(VIEWPORT.center); // Force chunk update
    await viewer.waitForChunksToRender();
    console.log('Chunks loaded');
    console.log('World renderer meshes after load:', Object.keys(viewer.world.sectionMeshs).length);
    console.log('Loaded chunks:', Object.keys(worldView.loadedChunks).length);

    // Position camera based on structure size
    const cameraDistance = Math.max(size.x, size.y, size.z) * 1.5;
    viewer.camera.position.set(
      VIEWPORT.center.x + cameraDistance,
      VIEWPORT.center.y + cameraDistance / 2,
      VIEWPORT.center.z + cameraDistance
    );
    viewer.camera.lookAt(
      VIEWPORT.center.x,
      VIEWPORT.center.y,
      VIEWPORT.center.z
    );

    // Wait for textures to load
    console.log('Waiting for textures and chunks to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await viewer.waitForChunksToRender();
    
    console.log('Rendering scene...');
    renderer.render(viewer.scene, viewer.camera);

    console.log('Exporting to GLTF...');
    console.log('Scene children:', viewer.scene.children.length);
    console.log('Scene meshes:', viewer.scene.children.filter(c => c instanceof THREE.Mesh).length);
    const fileName = await exportToGLTF(viewer.scene, renderer, viewer.camera);
    console.log(`Successfully exported to: ./gltf_out/${fileName}`);
    process.exit(0);
  } catch (error) {
    console.error('Error processing NBT file:', error);
    process.exit(1);
  }
};

// Start the application
setupApplication().catch((error) => {
  console.error('Application error:', error);
  process.exit(1);
});