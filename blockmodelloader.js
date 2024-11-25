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

  getModel(blockName, blockState = {}) {
    const cleanName = this.cleanTexturePath(blockName)
    
    // Try cached model first
    const modelKey = this.cleanTexturePath(blockName.split('[')[0]) // Base name without state
    const cacheKey = `${modelKey}:${JSON.stringify(blockState)}`
    const cached = this.modelCache.get(cacheKey)
    if (cached) return cached

    // Get state-specific variant
    const blockStateData = this.blockStates[cleanName]
    let modelName = cleanName

    // Try multiple model name patterns
    const modelPatterns = [
      cleanName,
      `block/${cleanName}`,
      `minecraft:block/${cleanName}`,
      cleanName.replace('minecraft:', ''),
      cleanName.split('[')[0] // Try without state data
    ]

    // Add state-specific variants
    if (blockStateData?.variants) {
      const stateString = Object.entries(blockState)
        .map(([key, value]) => `${key}=${value}`)
        .join(',') || ''
      
      const variant = blockStateData.variants[stateString] || blockStateData.variants['']
      if (variant?.model) {
        modelPatterns.push(
          this.cleanTexturePath(variant.model),
          `block/${this.cleanTexturePath(variant.model)}`,
          `minecraft:block/${this.cleanTexturePath(variant.model)}`
        )
      }
    }

    // Try each pattern until we find a model
    for (const pattern of modelPatterns) {
      const model = this.blockModels[pattern]
      if (model) {
        modelName = pattern
        break
      }
    }

    // Get and process model
    let model = this.blockModels[modelName]
    if (!model && modelName.includes('block/')) {
      model = this.blockModels[modelName.replace('block/', '')]
    }

    if (!model) {
      console.warn(`No model found for ${modelName}`)
      return null
    }

    // Process and cache the model
    console.log('Loading model:', {
      name: modelName,
      state: blockState,
      hasParent: !!model.parent,
      parentName: model.parent,
      elementCount: model.elements?.length
    })
    
    const processed = this.processModel(modelName, model)
    this.modelCache.set(cacheKey, processed)
    
    return processed
  }

  processModel(modelName, model) {
    if (!model) return null

    // Create a deep copy
    const processed = JSON.parse(JSON.stringify(model))

    // Handle parent inheritance recursively
    if (processed.parent) {
      // Try multiple parent name patterns without cleaning
      const parentPatterns = [
        processed.parent,
        processed.parent.replace('minecraft:', ''),
        `block/${processed.parent.replace('minecraft:', '')}`,
        processed.parent.replace('block/', '')
      ]
      
      let parentModel = null
      let foundPattern = null
      for (const pattern of parentPatterns) {
        parentModel = this.blockModels[pattern]
        if (parentModel) {
          foundPattern = pattern
          break
        }
      }
      
      if (parentModel) {
        const processedParent = this.processModel(foundPattern, parentModel)
        this.mergeModels(processed, processedParent)
      }
    }

    // Process textures
    processed.textures = this.resolveTextures(processed.textures || {})

    // Process elements
    if (processed.elements) {
      processed.elements = processed.elements.map(element => {
        // Keep original coordinates (0-16) for proper scaling
        return this.processElement(element, processed.textures)
      })
    }

    return processed
  }

  processElement(element, textures) {
    // Keep original Minecraft coordinates (0-16)
    const processed = {
      ...element,
      from: element.from,
      to: element.to
    }

    // Process rotation
    if (element.rotation) {
      processed.rotation = {
        ...element.rotation,
        origin: element.rotation.origin,  // Keep original coordinates
        angle: element.rotation.angle     // Keep angle in degrees
      }
    }

    // Process faces
    if (element.faces) {
      processed.faces = {}
      for (const [face, data] of Object.entries(element.faces)) {
        processed.faces[face] = {
          ...data,
          uv: data.uv?.map(v => v / 16), // Convert from MC 16x16 space to UV 0-1 space
          texture: this.resolveTextureReferences(data.texture, textures)
        }
      }
    }

    return processed
  }

  resolveTextures(textures) {
    const resolved = {}
    for (const [key, value] of Object.entries(textures)) {
      resolved[key] = this.resolveTextureReferences(value, textures)
    }
    return resolved
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