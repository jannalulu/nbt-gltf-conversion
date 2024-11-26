import { promises as fs } from 'fs'
import path from 'path'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

/**
 * Convert an NBT file buffer to GLTF format
 * @param {Buffer} nbtBuffer - The NBT file contents as a buffer
 * @param {Object} options - Conversion options
 * @param {string} [options.outputPath] - Directory to save the GLTF file
 * @param {string} [options.fileName] - Name for the output file
 * @returns {Promise<Object|string>} GLTF data object, or file path if outputPath specified
 */
export async function convertNbtToGltf(nbtBuffer, options = {}) {
  // Import dynamically to avoid loading Three.js and other heavy dependencies
  // until the function is actually called
  const { main } = await import('./index.js')
  
  const scene = await main(nbtBuffer)
  
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(scene,
      async (gltfData) => {
        if (options.outputPath) {
          const fileName = options.fileName || `structure_${Date.now()}.gltf`
          const filePath = path.join(options.outputPath, fileName)
          await fs.mkdir(options.outputPath, { recursive: true })
          await fs.writeFile(filePath, JSON.stringify(gltfData))
          resolve(filePath)
        } else {
          resolve(gltfData)
        }
      },
      (error) => reject(error),
      {
        binary: false,
        onlyVisible: true,
        includeCustomExtensions: true,
        trs: false
      }
    )
  })
}
