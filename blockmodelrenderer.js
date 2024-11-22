import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

class BlockModelRenderer {
  constructor(scene) {
    this.scene = scene;
    this.geometryCache = new Map();
    this.materialCache = new Map();
  }

  createGeometryFromModel(model) {
    if (!model || !model.elements) {
      return new THREE.BoxGeometry(1, 1, 1); // Fallback to basic cube
    }

    const geometries = [];
    
    for (const element of model.elements) {
      // Convert Minecraft coordinates (0-16) to Three.js coordinates (0-1)
      const from = element.from.map(v => v / 16);
      const to = element.to.map(v => v / 16);
      
      // Create box geometry for this element
      const width = to[0] - from[0];
      const height = to[1] - from[1];
      const depth = to[2] - from[2];
      
      const geometry = new THREE.BoxGeometry(width, height, depth);
      
      // Center the geometry
      geometry.translate(
        from[0] + width / 2 - 0.5,
        from[1] + height / 2 - 0.5,
        from[2] + depth / 2 - 0.5
      );

      // Apply rotations if specified
      if (element.rotation) {
        const angle = (element.rotation.angle * Math.PI) / 180;
        const origin = element.rotation.origin.map(v => v / 16 - 0.5);
        
        geometry.translate(-origin[0], -origin[1], -origin[2]);
        
        switch (element.rotation.axis) {
          case 'x':
            geometry.rotateX(angle);
            break;
          case 'y':
            geometry.rotateY(angle);
            break;
          case 'z':
            geometry.rotateZ(angle);
            break;
        }
        
        geometry.translate(origin[0], origin[1], origin[2]);
      }

      // Apply UVs based on the face definitions
      if (element.faces) {
        const uvs = geometry.attributes.uv
        const uvArray = uvs.array
        
        for (const [face, data] of Object.entries(element.faces)) {
          const faceIndex = ['east', 'west', 'up', 'down', 'south', 'north'].indexOf(face);
          if (faceIndex === -1) continue
          
          const baseIndex = faceIndex * 8 // 4 vertices * 2 coordinates per vertex
          const uv = data.uv || [0, 0, 16, 16]
          
          // Convert Minecraft UVs (0-16) to Three.js UVs (0-1)
          const uvScale = 1 / 16;
          uvArray[baseIndex + 0] = uv[0] * uvScale
          uvArray[baseIndex + 1] = uv[1] * uvScale
          uvArray[baseIndex + 2] = uv[2] * uvScale
          uvArray[baseIndex + 3] = uv[1] * uvScale
          uvArray[baseIndex + 4] = uv[0] * uvScale
          uvArray[baseIndex + 5] = uv[3] * uvScale
          uvArray[baseIndex + 6] = uv[2] * uvScale
          uvArray[baseIndex + 7] = uv[3] * uvScale
        }
        
        uvs.needsUpdate = true
      }

      geometries.push(geometry)
    }

    // Merge all element geometries into one
    if (geometries.length === 0) {
      return new THREE.BoxGeometry(1, 1, 1)
    } else if (geometries.length === 1) {
      return geometries[0]
    } else {
      const mergedGeometry = mergeGeometries(geometries)
      geometries.forEach(g => g.dispose())
      return mergedGeometry
    }
  }

  applyTextureToMaterial(material, textures, blockStates, uvMapping) {
    if (!material || !textures || !blockStates) return material;

    const state = blockStates[Object.keys(blockStates)[0]]; // Get first state
    if (!state || !state.variants || !state.variants.normal) return material;

    const variant = state.variants.normal;
    if (!variant.model || !variant.model.textures) return material;

    // Apply textures based on the model's texture definitions
    const modelTextures = variant.model.textures;
    for (const [key, textureName] of Object.entries(modelTextures)) {
      const textureKey = textureName.replace('minecraft:block/', '');
      if (uvMapping[textureKey]) {
        const uvs = uvMapping[textureKey];
        if (material.map) {
          material.map.repeat.set(uvs.width, uvs.height);
          material.map.offset.set(uvs.x, uvs.y);
          material.map.needsUpdate = true;
        }
      }
    }

    return material;
  }

  createBlockMesh(blockId, model, textures, blockStates, uvMapping) {
    const cacheKey = `${blockId}_${model?.parent || 'default'}`;
    
    let geometry = this.geometryCache.get(cacheKey);
    if (!geometry) {
      geometry = this.createGeometryFromModel(model);
      this.geometryCache.set(cacheKey, geometry);
    }

    const material = this.createMaterial(blockId);
    this.applyTextureToMaterial(material, textures, blockStates, uvMapping);

    return new THREE.Mesh(geometry, material);
  }

  createMaterial(blockId) {
    if (this.materialCache.has(blockId)) {
      return this.materialCache.get(blockId).clone();
    }

    const material = new THREE.MeshStandardMaterial({
      roughness: 1.0,
      metalness: 0.0,
      transparent: true,
      alphaTest: 0.1
    });

    this.materialCache.set(blockId, material);
    return material;
  }
}

export default BlockModelRenderer;