import path from 'path';
import { promises as fs } from 'fs';

class BlockModelLoader {
  constructor(assetsDirectory) {
    this.assetsDirectory = assetsDirectory;
    this.modelCache = new Map();
    this.blockModels = null;
    this.blockStates = null;
  }

  async loadBlockModels() {
    try {
      // Load both models and states
      const [modelData, stateData] = await Promise.all([
        fs.readFile(path.join(this.assetsDirectory, 'blocks_models.json')).then(JSON.parse),
        fs.readFile(path.join(this.assetsDirectory, 'blocks_states.json')).then(JSON.parse)
      ]);

      this.blockModels = modelData;
      this.blockStates = stateData;
      return this.blockModels;
    } catch (error) {
      console.error('Error loading block data:', error);
      throw error;
    }
  }

  getModel(blockName, variant = null) {
    // Check if block has states/variants
    const blockState = this.blockStates?.[blockName];
    let modelName = blockName;
    let rotation = { x: 0, y: 0 };

    if (blockState?.variants) {
      // Get default variant if none specified
      const variantKey = variant || Object.keys(blockState.variants)[0];
      const variantData = blockState.variants[variantKey];

      if (variantData) {
        // Handle both single variant and multiple possibilities
        const variantModel = Array.isArray(variantData) ? variantData[0] : variantData;
        
        if (variantModel.model) {
          modelName = variantModel.model.replace('minecraft:block/', '');
        }
        
        // Store rotation data
        rotation.x = variantModel.x || 0;
        rotation.y = variantModel.y || 0;
      }
    }

    // Get the base model
    let model = this.blockModels[modelName];
    if (!model) {
      console.warn(`No model found for ${blockName} (${modelName})`);
      return null;
    }

    // Resolve parent chain
    const modelChain = [];
    let currentModel = model;
    while (currentModel?.parent) {
      const parentName = currentModel.parent.replace('minecraft:block/', '');
      const parentModel = this.blockModels[parentName];
      if (!parentModel) {
        console.warn(`Parent model ${parentName} not found for ${blockName}`);
        break;
      }
      modelChain.unshift(parentModel);
      currentModel = parentModel;
    }

    // Merge all models in chain
    let finalModel = modelChain.reduce((merged, next) => this.mergeModels(merged, next), {});
    finalModel = this.mergeModels(finalModel, model);

    // Add rotation data
    finalModel.rotation = rotation;

    return finalModel;
  }

  mergeModels(parent, child) {
    const merged = { ...parent };

    // Merge textures
    merged.textures = { ...parent.textures };
    for (const [key, value] of Object.entries(child.textures || {})) {
      if (value.startsWith('#')) {
        const ref = value.substring(1);
        merged.textures[key] = merged.textures[ref] || child.textures[ref] || value;
      } else {
        merged.textures[key] = value;
      }
    }

    // Child elements override parent elements
    if (child.elements) {
      merged.elements = child.elements;
    }

    return merged;
  }
}

export default BlockModelLoader;