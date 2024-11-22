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
          
          // Store all variants of the texture name
          const variants = [
            cleanName,
            `block/${cleanName}`,
            `minecraft:block/${cleanName}`,
            cleanTexture,
            cleanTexture.split('/').pop(),
            entry.texture // Keep original texture path too
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
    console.log(`Getting model for ${blockName} (cleaned: ${cleanName})`)

    // Special case handling
    if (cleanName === 'glass_pane') {
      return this.getGlassPaneModel()
    } else if (cleanName === 'lantern') {
      return this.getLanternModel()
    }

    // Try cached model first
    const cached = this.modelCache.get(cleanName)
    if (cached) return cached

    // Get base model
    let model = this.blockModels[cleanName] || this.blockModels[`block/${cleanName}`]
    
    if (!model) {
      console.warn(`No direct model found for ${cleanName}`)
      return null
    }

    // Process the model
    model = this.processModel(cleanName, model)
    
    console.log(`Processed model for ${cleanName}:`, {
      hasTextures: !!model.textures,
      textureCount: model.textures ? Object.keys(model.textures).length : 0,
      sampleTextures: model.textures ? Object.entries(model.textures).slice(0, 2) : []
    })

    return model
  }

  getGlassPaneModel() {
    // Combine post and side models for glass panes
    const postModel = this.blockModels['glass_pane_post'] || this.blockModels['block/glass_pane_post']
    const sideModel = this.blockModels['glass_pane_side'] || this.blockModels['block/glass_pane_side']

    if (!postModel || !sideModel) {
      console.warn('Missing glass pane model components')
      return null
    }

    // Create combined model
    const combinedModel = {
      elements: [
        ...(postModel.elements || []),
        ...(sideModel.elements || [])
      ],
      textures: {
        ...postModel.textures,
        ...sideModel.textures,
        particle: 'minecraft:block/glass',
        pane: 'minecraft:block/glass'
      }
    }

    return this.processModel('glass_pane', combinedModel)
  }

  getLanternModel() {
    const model = this.blockModels['lantern'] || this.blockModels['block/lantern']
    if (!model) {
      console.warn('No lantern model found')
      return null
    }

    // Ensure proper texture mappings for lantern
    const processedModel = this.processModel('lantern', {
      ...model,
      textures: {
        ...model.textures,
        particle: 'minecraft:block/lantern',
        lantern: 'minecraft:block/lantern',
        all: 'minecraft:block/lantern'
      }
    })

    // Add any missing UV mappings
    if (processedModel.elements) {
      processedModel.elements.forEach(element => {
        if (element.faces) {
          Object.values(element.faces).forEach(face => {
            if (!face.uv) {
              face.uv = [0, 0, 16, 16]
            }
          })
        }
      })
    }

    return processedModel
  }

  processModel(modelName, model) {
    if (!model) return null

    // Create a deep copy
    const processed = JSON.parse(JSON.stringify(model))

    // Handle parent inheritance
    if (processed.parent) {
      const parentName = this.cleanTexturePath(processed.parent)
      const parentModel = this.blockModels[parentName]
      
      if (parentModel) {
        const mergedModel = this.mergeModels(parentModel, processed)
        processed.textures = mergedModel.textures
        processed.elements = mergedModel.elements
      }
    }

    // Ensure textures object exists
    if (!processed.textures) {
      processed.textures = {}
    }

    // Try to find textures if none are specified
    if (Object.keys(processed.textures).length === 0) {
      processed.textures = {
        all: `minecraft:block/${modelName}`,
        particle: `minecraft:block/${modelName}`
      }
    }

    // Resolve texture references
    processed.textures = this.resolveTextureReferences(processed.textures, modelName)

    // Cache the processed model
    this.modelCache.set(modelName, processed)
    
    return processed
  }

  resolveTextureReferences(textures, modelName) {
    const resolved = {}
    const seen = new Set()

    const resolveReference = (key, value) => {
      if (!value || seen.has(value)) return value
      seen.add(value)

      // Handle reference to another texture
      if (value.startsWith('#')) {
        const referencedKey = value.substring(1)
        return textures[referencedKey] ? resolveReference(key, textures[referencedKey]) : value
      }

      // Get actual texture path from mapping
      const mappedTexture = this.textureMap.get(this.cleanTexturePath(value))
      if (mappedTexture) {
        return mappedTexture
      }

      // Return cleaned value if no mapping found
      return this.cleanTexturePath(value)
    }

    // Resolve all texture references
    for (const [key, value] of Object.entries(textures)) {
      resolved[key] = resolveReference(key, value)
    }

    return resolved
  }

  cleanTexturePath(path) {
    if (!path) return path
    return path.replace('minecraft:', '')
               .replace(/^block\//, '')
               .replace(/^blocks\//, '')
               .replace(/^item\//, '')
               .replace(/^items\//, '')
  }

  mergeModels(parent, child) {
    const merged = {
      ...parent,
      ...child,
      textures: { ...parent.textures, ...child.textures }
    }

    if (parent.elements && child.elements) {
      merged.elements = [...parent.elements, ...child.elements]
    } else {
      merged.elements = child.elements || parent.elements
    }

    return merged
  }
}

export default BlockModelLoader