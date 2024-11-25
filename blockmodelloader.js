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
    
    // Convert block state values to strings if they're not already
    const state = Object.fromEntries(
      Object.entries(blockState).map(([k, v]) => [k, String(v)])
    )
    
    // Special case handling
    switch (cleanName) {
      case 'glass_pane':
        return this.createGlassPaneModel(state)
      case 'lantern':
        return this.createLanternModel(state)
      default:
        return this.getDefaultModel(cleanName)
    }
  }

  createLanternModel(state) {
    console.log('Creating lantern model with state:', state)
    
    const isHanging = state.hanging === 'true'
    const templateName = isHanging ? 'template_hanging_lantern' : 'template_lantern'
    
    // Get the base template
    const template = this.blockModels[templateName]
    if (!template) {
      console.warn(`No template found for ${templateName}`)
      return null
    }

    // Create model with correct template and textures
    const model = {
      ...template,
      textures: {
        ...template.textures,
        lantern: 'minecraft:block/lantern'
      }
    }

    console.log('Created lantern model:', {
      template: templateName,
      isHanging,
      elementCount: model.elements?.length
    })

    return this.resolveModelParent(model)
  }

  createGlassPaneModel(state) {
    console.log('Creating glass pane model with state:', state)
    
    const model = {
      parent: 'block/block',
      textures: {
        pane: 'minecraft:block/glass',
        edge: 'minecraft:block/glass_pane_top'
      },
      elements: []
    }

    // Add central post if any connections exist
    if (state.north === 'true' || state.south === 'true' || 
        state.east === 'true' || state.west === 'true') {
      const postModel = this.blockModels['template_glass_pane_post']
      if (postModel?.elements) {
        model.elements.push(...postModel.elements)
      }
    }

    // Add connecting panes based on state
    const directions = ['north', 'south', 'east', 'west']
    const angles = { north: 0, south: 180, east: 90, west: -90 }
    
    for (const dir of directions) {
      if (state[dir] === 'true') {
        const sideModel = this.blockModels['template_glass_pane_side']
        if (sideModel?.elements) {
          const rotatedElements = this.rotateElements(
            sideModel.elements, 
            angles[dir]
          )
          model.elements.push(...rotatedElements)
        }
      }
    }

    // Add no-side elements where there are no connections
    if (!directions.some(dir => state[dir] === 'true')) {
      const nosideModel = this.blockModels['template_glass_pane_noside']
      if (nosideModel?.elements) {
        model.elements.push(...nosideModel.elements)
      }
    }

    return model
  }

  getDefaultModel(blockName) {
    const modelPatterns = [
      blockName,
      `minecraft:block/${blockName}`,
      `block/${blockName}`,
      blockName.replace('minecraft:', '')
    ]

    let model = null
    for (const pattern of modelPatterns) {
      model = this.blockModels[pattern]
      if (model) break
    }

    if (!model) {
      console.warn(`No model found for ${blockName}`)
      return null
    }

    return this.resolveModelParent(model)
  }

  rotateElements(elements, angle) {
    return elements.map(element => ({
      ...element,
      rotation: {
        origin: [8, 8, 8],
        axis: 'y',
        angle: angle + (element.rotation?.angle || 0)
      }
    }))
  }

  resolveModelParent(model, visited = new Set()) {
    if (!model) return null

    const processedModel = { ...model }

    if (model.parent) {
      const parentPatterns = [
        model.parent,
        model.parent.replace('minecraft:', ''),
        model.parent.replace('block/', ''),
        `minecraft:block/${model.parent}`,
        `block/${model.parent}`,
        model.parent.replace('template_', ''),
        `template_${model.parent}`,
        model.parent.replace('minecraft:block/', '')
      ]

      let parentModel = null
      for (const pattern of parentPatterns) {
        if (visited.has(pattern)) continue
        
        parentModel = this.blockModels[pattern]
        if (parentModel) {
          visited.add(pattern)
          const resolvedParent = this.resolveModelParent(parentModel, visited)
          
          if (resolvedParent) {
            processedModel.elements = resolvedParent.elements || processedModel.elements
            processedModel.textures = { 
              ...resolvedParent.textures, 
              ...processedModel.textures 
            }
          }
          break
        }
      }
    }

    return processedModel
  }

  cleanTexturePath(path) {
    if (!path) return path
    return path.replace('minecraft:', '')
               .replace(/^block\//, '')
               .replace(/^blocks\//, '')
  }
}

export default BlockModelLoader