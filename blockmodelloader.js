import path from 'path'
import { promises as fs } from 'fs'

class BlockModelLoader {
  constructor(assetsDirectory) {
    this.assetsDirectory = assetsDirectory
    this.modelCache = new Map()
    this.blockModels = null
    this.blockStates = null
    this.textureMap = new Map()
  }

  async loadBlockModels() {
    try {
      const modelsJson = await fs.readFile(path.join(this.assetsDirectory, 'blocks_models.json'), 'utf8')
      const modelData = modelsJson.trim().split('</blocks_models.json>')[0]
        .replace('<blocks_models.json>', '')
        .trim()

      this.blockModels = JSON.parse(modelData)

      // Load block states
      const statesJson = await fs.readFile(path.join(this.assetsDirectory, 'blocks_states.json'), 'utf8')
      const stateData = statesJson.trim().split('</block_states.json>')[0]
        .replace('<blocks_states.json>', '')
        .trim()

      this.blockStates = JSON.parse(stateData)

      // Load texture mappings
      const texturesJson = await fs.readFile(path.join(this.assetsDirectory, 'blocks_textures.json'), 'utf8')
      const textureData = texturesJson.trim().split('</blocks_textures.json>')[0]
        .replace('<blocks_textures.json>', '')
        .trim()

      const texturesData = JSON.parse(textureData)

      // Build texture mapping
      for (const entry of texturesData) {
        if (entry.texture) {
          const cleanName = this.cleanTexturePath(entry.name)
          const cleanTexture = this.cleanTexturePath(entry.texture)
          
          const variants = [
            cleanName,
            `block/${cleanName}`,
            `minecraft:block/${cleanName}`,
            cleanTexture,
            cleanTexture.split('/').pop(),
            entry.texture
          ]

          variants.forEach(variant => {
            if (variant) this.textureMap.set(variant, entry.texture)
          })
        }
      }

      console.log('Model loading complete:', {
        modelCount: Object.keys(this.blockModels).length,
        stateCount: Object.keys(this.blockStates).length,
        textureCount: this.textureMap.size
      })

      return true
    } catch (error) {
      console.error('Error loading block data:', error)
      throw error
    }
  }

  getModel(blockName) {
    const cleanName = this.cleanTexturePath(blockName)
    
    // Try cached model first
    const cached = this.modelCache.get(cleanName)
    if (cached) return cached

    // Get base model
    let model = this.blockModels[cleanName]
    if (!model) {
      model = this.blockModels[`block/${cleanName}`]
    }
    
    if (!model) {
      console.warn(`No model found for ${cleanName}`)
      return null
    }

    // Process the model
    model = this.processModel(cleanName, model)
    
    return model
  }

  processModel(modelName, model) {
    if (!model) return null

    // Create a deep copy to avoid modifying the original
    const processed = JSON.parse(JSON.stringify(model))

    // First, handle parent inheritance recursively
    if (processed.parent) {
      const parentName = this.cleanTexturePath(processed.parent)
      const parentModel = this.blockModels[parentName]
      
      if (parentModel) {
        // Process parent first
        const processedParent = this.processModel(parentName, parentModel)
        // Then merge with current model
        this.mergeModels(processed, processedParent)
      }
    }

    // Handle textures
    if (!processed.textures) {
      processed.textures = {}
    }

    // Resolve texture variables
    processed.textures = this.resolveTextureReferences(processed.textures)

    // Process elements and their faces
    if (processed.elements) {
      processed.elements = processed.elements.map(element => {
        // Handle faces
        if (element.faces) {
          Object.entries(element.faces).forEach(([faceName, face]) => {
            // Resolve texture reference
            if (face.texture && face.texture.startsWith('#')) {
              const textureKey = face.texture.substring(1)
              face.texture = processed.textures[textureKey] || face.texture
            }

            // Normalize UV coordinates (Minecraft uses 0-16 range)
            if (face.uv) {
              face.uv = face.uv.map(coord => coord / 16)
            }
          })
        }

        // Handle rotation
        if (element.rotation) {
          element.rotation.origin = element.rotation.origin.map(coord => coord / 16)
          element.rotation.angle = (element.rotation.angle * Math.PI) / 180
        }

        // Convert coordinates from Minecraft space (0-16) to Three.js space (0-1)
        element.from = element.from.map(coord => coord / 16)
        element.to = element.to.map(coord => coord / 16)

        return element
      })
    }

    // Cache the processed model
    this.modelCache.set(modelName, processed)
    
    return processed
  }

  resolveTextureReferences(textures) {
    const resolved = {}
    const seen = new Set()

    const resolveReference = (key, value) => {
      if (!value || seen.has(value)) return value
      seen.add(value)

      // Handle reference to another texture
      if (value.startsWith('#')) {
        const referencedKey = value.substring(1)
        return textures[referencedKey] ? resolveReference(referencedKey, textures[referencedKey]) : value
      }

      // Get actual texture path from mapping
      const cleanPath = this.cleanTexturePath(value)
      const mappedTexture = this.textureMap.get(cleanPath)
      
      if (mappedTexture) {
        return mappedTexture
      }

      // If no mapping found, try to clean up the path
      return cleanPath
    }

    // Resolve all texture references
    for (const [key, value] of Object.entries(textures)) {
      resolved[key] = resolveReference(key, value)
    }

    return resolved
  }

  mergeModels(target, source) {
    // Don't merge if source is null
    if (!source) return target

    // Merge textures
    if (source.textures) {
      target.textures = { ...source.textures, ...target.textures }
    }

    // Merge elements
    if (source.elements && !target.elements) {
      target.elements = [...source.elements]
    }

    // Copy any other properties that don't exist in target
    Object.keys(source).forEach(key => {
      if (!(key in target)) {
        target[key] = source[key]
      }
    })

    return target
  }

  cleanTexturePath(path) {
    if (!path) return path
    return path.replace('minecraft:', '')
               .replace(/^block\//, '')
               .replace(/^blocks\//, '')
               .replace(/^item\//, '')
               .replace(/^items\//, '')
  }
}

export default BlockModelLoader