import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import BlockModelLoader from './blockmodelloader.js'

class EnhancedMockWorker {
  constructor(scene, mcData) {
    this.scene = scene
    this.mcData = mcData
    this.meshes = new Map()
    this.atlas = null
    this.uvMapping = {}
    this.blockStates = null
    this.modelLoader = null
    this.materialCache = new Map()
    this.geometryCache = new Map()
    
    this.initialize = this.initialize.bind(this)
    this.setAtlas = this.setAtlas.bind(this)
    this.addMesh = this.addMesh.bind(this)
    this.handleMessage = this.handleMessage.bind(this)
    this.postMessage = this.handleMessage.bind(this)
    this.createGeometryFromModel = this.createGeometryFromModel.bind(this)
    this.createMaterial = this.createMaterial.bind(this)
  }

  setAtlas(atlas, uvMapping, blockStates) {
    if (!atlas || !uvMapping || !blockStates) {
      console.warn('Invalid atlas data provided')
      return
    }
    this.atlas = atlas
    this.uvMapping = uvMapping
    this.blockStates = blockStates
  }

  handleMessage(data) {
    if (!data) return
    if (data.type === 'add_mesh') {
      this.addMesh(data)
    } else {
      console.warn('Unknown message type:', data.type)
    }
  }

  async initialize(assetsDirectory) {
    if (!assetsDirectory) {
      throw new Error('Assets directory is required')
    }
    console.log('Initializing worker with assets directory:', assetsDirectory)
    this.modelLoader = new BlockModelLoader(assetsDirectory)
    await this.modelLoader.loadBlockModels()
    console.log('Worker initialization complete')
  }

  resolveTexture(textureName) {
    if (!textureName) return null;

    // Clean up texture name
    const cleanName = textureName
      .replace('minecraft:block/', '')
      .replace('minecraft:item/', '')
      .replace('minecraft:items/', '')
      .replace('block/', '')
      .replace('item/', '')
      .replace('items/', '');

    // Try different possible texture locations
    const possiblePaths = [
      cleanName,
      `block/${cleanName}`,
      `item/${cleanName}`,
      `items/${cleanName}`
    ];

    for (const path of possiblePaths) {
      if (this.uvMapping[path]) {
        return {
          name: path,
          mapping: this.uvMapping[path]
        };
      }
    }

    console.warn(`No texture mapping found for ${textureName}, tried:`, possiblePaths);
    return null;
  }

  createMaterial(blockId, textureName) {
    if (!blockId || !textureName) {
      return new THREE.MeshStandardMaterial();
    }

    const cacheKey = `${blockId}_${textureName}`;
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey).clone();
    }

    const block = this.mcData.blocks[blockId];
    if (!block) {
      return new THREE.MeshStandardMaterial();
    }

    const resolvedTexture = this.resolveTexture(textureName);
    if (!resolvedTexture) {
      console.warn(`Could not resolve texture for ${textureName}`);
      return new THREE.MeshStandardMaterial();
    }

    const material = new THREE.MeshStandardMaterial({
      name: `${block.name}_${resolvedTexture.name}`,
      transparent: block.transparent,
      side: THREE.DoubleSide,
      roughness: 1.0,
      metalness: 0.0
    });

    if (this.atlas && resolvedTexture.mapping) {
      const texture = this.atlas.clone();
      texture.repeat.set(resolvedTexture.mapping.width || 1, resolvedTexture.mapping.height || 1);
      texture.offset.set(resolvedTexture.mapping.x || 0, resolvedTexture.mapping.y || 0);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.needsUpdate = true;

      material.map = texture;
      material.needsUpdate = true;
    }

    this.materialCache.set(cacheKey, material);
    return material;
  }

  createGeometryFromModel(model, blockState) {
    if (!model?.elements) {
      return new THREE.BoxGeometry(1, 1, 1);
    }

    // Resolve all texture references first
    const resolvedTextures = {};
    if (model.textures) {
      for (const [key, value] of Object.entries(model.textures)) {
        if (value.startsWith('#')) {
          const ref = value.substring(1);
          resolvedTextures[key] = model.textures[ref] || value;
        } else {
          resolvedTextures[key] = value;
        }
      }
    }

    const geometries = [];
    
    for (const element of model.elements) {
      if (!element.from || !element.to || !element.faces) continue;

      const from = element.from.map(v => v / 16);
      const to = element.to.map(v => v / 16);
      
      const width = Math.abs(to[0] - from[0]);
      const height = Math.abs(to[1] - from[1]);
      const depth = Math.abs(to[2] - from[2]);
      
      const geometry = new THREE.BoxGeometry(width, height, depth);

      geometry.translate(
        from[0] + width / 2 - 0.5,
        from[1] + height / 2 - 0.5,
        from[2] + depth / 2 - 0.5
      );

      if (element.rotation) {
        const origin = element.rotation.origin.map(v => v / 16 - 0.5);
        const angle = (element.rotation.angle * Math.PI) / 180;
        
        geometry.translate(-origin[0], -origin[1], -origin[2]);
        
        switch (element.rotation.axis) {
          case 'x': geometry.rotateX(angle); break;
          case 'y': geometry.rotateY(angle); break;
          case 'z': geometry.rotateZ(angle); break;
        }
        
        geometry.translate(origin[0], origin[1], origin[2]);
      }

      if (element.faces) {
        const uvAttribute = geometry.getAttribute('uv');
        const uvs = uvAttribute.array;
        
        const faceIndices = {
          east:  [0, 1, 2, 3, 0, 3, 2, 1],
          west:  [4, 5, 6, 7, 4, 7, 6, 5],
          up:    [8, 9, 10, 11, 8, 11, 10, 9],
          down:  [12, 13, 14, 15, 12, 15, 14, 13],
          south: [16, 17, 18, 19, 16, 19, 18, 17],
          north: [20, 21, 22, 23, 20, 23, 22, 21]
        };

        for (const [face, faceData] of Object.entries(element.faces)) {
          if (!faceData?.uv) continue;

          const indices = faceIndices[face];
          if (!indices) continue;

          const uv = faceData.uv;
          const uvScale = 1 / 16;

          for (let i = 0; i < indices.length; i += 2) {
            uvs[indices[i]] = uv[i % 4 < 2 ? 0 : 2] * uvScale;
            uvs[indices[i + 1]] = (1 - uv[i % 4 === 0 || i % 4 === 3 ? 3 : 1]) * uvScale;
          }
        }
        
        uvAttribute.needsUpdate = true;
      }

      geometries.push(geometry);
    }

    // Merge geometries
    let finalGeometry;
    if (geometries.length === 0) {
      finalGeometry = new THREE.BoxGeometry(1, 1, 1);
    } else if (geometries.length === 1) {
      finalGeometry = geometries[0];
    } else {
      try {
        finalGeometry = mergeGeometries(geometries);
        geometries.forEach(g => g.dispose());
      } catch (error) {
        console.warn('Failed to merge geometries:', error);
        finalGeometry = geometries[0];
      }
    }

    // Apply block state rotation
    if (blockState?.y) {
      finalGeometry.rotateY(blockState.y * Math.PI / 180);
    }
    if (blockState?.x) {
      finalGeometry.rotateX(blockState.x * Math.PI / 180);
    }

    return finalGeometry;
  }

  addMesh(data) {
    if (!data?.blocks?.length) return;

    const { x, z, blocks } = data;
    const blocksByType = new Map();
    
    for (const block of blocks) {
      if (!block?.position || block.type === 0) continue;
      
      if (!blocksByType.has(block.type)) {
        blocksByType.set(block.type, []);
      }
      blocksByType.get(block.type).push(block);
    }

    for (const [blockType, typeBlocks] of blocksByType) {
      const blockName = this.mcData.blocks[blockType]?.name;
      if (!blockName) {
        console.warn(`Unknown block type: ${blockType}`);
        continue;
      }

      // Get block state if available
      const blockState = this.blockStates?.[blockName]?.variants?.[''];
      const model = this.modelLoader.getModel(blockName);
      if (!model) continue;

      let geometry;
      const cacheKey = `${blockType}_${model.parent || 'default'}`;
      if (this.geometryCache.has(cacheKey)) {
        geometry = this.geometryCache.get(cacheKey);
      } else {
        geometry = this.createGeometryFromModel(model, blockState);
        this.geometryCache.set(cacheKey, geometry);
      }

      // Get correct texture from model
      const textureName = model.textures?.all || 
                         model.textures?.particle ||
                         model.textures?.texture ||
                         blockName;

      const material = this.createMaterial(blockType, textureName);
      
      const instancedMesh = new THREE.InstancedMesh(
        geometry,
        material,
        typeBlocks.length
      );

      instancedMesh.name = `${blockName}_mesh_${x}_${z}`;

      const matrix = new THREE.Matrix4();
      typeBlocks.forEach((block, index) => {
        matrix.setPosition(
          x * 16 + block.position[0],
          block.position[1],
          z * 16 + block.position[2]
        );
        instancedMesh.setMatrixAt(index, matrix);
      });

      const meshId = `${x},${z},${blockType}`;
      if (this.meshes.has(meshId)) {
        const oldMesh = this.meshes.get(meshId);
        this.scene.remove(oldMesh);
        oldMesh.geometry?.dispose();
        if (Array.isArray(oldMesh.material)) {
          oldMesh.material.forEach(m => m?.dispose());
        } else {
          oldMesh.material?.dispose();
        }
      }
      
      this.meshes.set(meshId, instancedMesh);
      this.scene.add(instancedMesh);
    }
  }
}

export default EnhancedMockWorker;