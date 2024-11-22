import path from 'path'
import { promises as fs } from 'fs'

class BlockModelLoader {
  constructor(assetsDirectory) {
    this.assetsDirectory = assetsDirectory
    this.modelCache = new Map()
    this.blockModels = null
  }

  async loadBlockModels() {
    try {
      // Load block models JSON
      const modelsPath = path.join(this.assetsDirectory, 'blocks_models.json')
      console.log('Loading models from:', modelsPath)
      
      const modelData = JSON.parse(await fs.readFile(modelsPath, 'utf8'))
      console.log('Sample of loaded models:', 
        Object.entries(modelData)
          .slice(0, 3)
          .map(([name, model]) => ({
            name,
            hasParent: !!model.parent,
            hasTextures: !!model.textures,
            parent: model.parent,
            textures: model.textures
          }))
      )

      this.blockModels = modelData

      // Process and cache each model
      for (const [modelName, model] of Object.entries(modelData)) {
        console.log(`Processing model ${modelName}`)
        const processed = this.processModel(modelName, model)
        console.log('Processed result:', {
          name: modelName,
          hasTextures: !!processed?.textures,
          textures: processed?.textures
        })
      }

      return this.blockModels
    } catch (error) {
      console.error('Error loading block models:', error)
      throw error
    }
  }

  getModel(blockName) {
    console.log('Getting model for:', blockName, {
      inCache: this.modelCache.has(blockName),
      inModels: blockName in this.blockModels,
      cacheKeys: Array.from(this.modelCache.keys()).slice(0, 5)
    })

    // Try with different name variations
    const variations = [
      blockName,
      `block/${blockName}`,
      blockName.replace('block/', '')
    ]

    for (const name of variations) {
      const model = this.modelCache.get(name)
      if (model) {
        console.log('Found model for', blockName, 'using variant', name, {
          hasTextures: !!model.textures,
          textures: model.textures
        })
        return model
      }
    }

    // If not in cache, try to load from blockModels
    for (const name of variations) {
      if (name in this.blockModels) {
        const model = this.processModel(name, this.blockModels[name])
        console.log('Processed new model for', blockName, {
          hasTextures: !!model.textures,
          textures: model.textures
        })
        return model
      }
    }

    console.warn(`No model found for ${blockName}`)
    return null
  }

  processModel(modelName, model) {
    console.log('Processing model:', {
      name: modelName,
      originalTextures: model.textures,
      parent: model.parent
    })

    // Create a deep copy to avoid modifying original
    const processed = JSON.parse(JSON.stringify(model))

    // Handle parent inheritance
    if (processed.parent) {
      const parentName = processed.parent.replace('minecraft:block/', '')
      const parentModel = this.blockModels[parentName]

      if (parentModel) {
        const mergedModel = this.mergeModels(parentModel, processed)
        processed.textures = mergedModel.textures
        processed.elements = mergedModel.elements
      }
    }

    // Resolve texture references
    if (processed.textures) {
      processed.textures = this.resolveTextureReferences(processed.textures)
    }

    // Cache the processed model
    this.modelCache.set(modelName, processed)
    return processed
  }

  resolveTextureReferences(textures) {
    const resolved = {}
    const seen = new Set()

    for (const [key, value] of Object.entries(textures)) {
      if (!seen.has(value)) {
        seen.add(value)
        if (value.startsWith('#')) {
          resolved[key] = textures[value.substring(1)] || value
        } else {
          resolved[key] = value
        }
      }
    }

    return resolved
  }

  mergeModels(parent, child) {
    return {
      ...parent,
      ...child,
      textures: { ...parent.textures, ...child.textures }
    }
  }
}
export default BlockModelLoader