// Sistema Híbrido + Obstáculos Brasileiros Icônicos:
// - Fiat Uno Mille (com opção de escada no teto!)
// - Fusca Clássico
// - Kombi Clássica (saia e blusa branca/azul)
// - Táxi Amarelo do Rio de Janeiro
// - Cachorro Caramelo atravessando a pista
// - Carrinho de Coco / Cavalete de Obra / Faixa Alta

const loadedGLBTemplates = {
    lula: null,
    bolsonaro: null
};

// Clonagem segura para SkinnedMesh (Mixamo/Blender) sem perder o esqueleto (bones)
function cloneSkinnedScene(source) {
    const sourceLookup = new Map();
    const cloneLookup = new Map();
    const clone = source.clone();

    const parallelTraverse = (a, b, callback) => {
        callback(a, b);
        for (let i = 0; i < a.children.length; i++) {
            parallelTraverse(a.children[i], b.children[i], callback);
        }
    };

    parallelTraverse(source, clone, (sourceNode, clonedNode) => {
        sourceLookup.set(clonedNode, sourceNode);
        cloneLookup.set(sourceNode, clonedNode);
    });

    clone.traverse((node) => {
        if (!node.isSkinnedMesh) return;
        const sourceMesh = sourceLookup.get(node);
        const sourceBones = sourceMesh.skeleton.bones;
        node.skeleton = sourceMesh.skeleton.clone();
        node.bindMatrix.copy(sourceMesh.bindMatrix);
        node.skeleton.bones = sourceBones.map((bone) => cloneLookup.get(bone));
        node.bind(node.skeleton, node.bindMatrix);
    });

    return clone;
}

function preloadExternalGLBModels(onModelReady) {
    if (typeof THREE.GLTFLoader === 'undefined') return;
    const loader = new THREE.GLTFLoader();

    ['lula', 'bolsonaro'].forEach(charName => {
        const path = `assets/models/${charName}.glb`;
        loader.load(
            path,
            (gltf) => {
                const rawScene = gltf.scene;

                // Desativa frustumCulled em SkinnedMesh do Mixamo (evita ficar invisível quando os ossos movem!)
                rawScene.traverse(child => {
                    if (child.isMesh || child.isSkinnedMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        child.frustumCulled = false;
                        if (child.material) {
                            child.material.side = THREE.DoubleSide;
                            child.material.needsUpdate = true;
                        }
                    }
                });

                // Mede a altura usando os ossos (bones) ou geometria (funciona tanto em metros quanto em cm do Mixamo)
                rawScene.updateMatrixWorld(true);
                const boneBox = new THREE.Box3();
                let boneCount = 0;
                rawScene.traverse(child => {
                    if (child.isBone) {
                        const pos = new THREE.Vector3();
                        child.getWorldPosition(pos);
                        boneBox.expandByPoint(pos);
                        boneCount++;
                    }
                });

                const meshBox = new THREE.Box3();
                let foundMesh = false;
                rawScene.traverse(child => {
                    if (child.isMesh && child.geometry) {
                        child.geometry.computeBoundingBox();
                        if (child.geometry.boundingBox && !child.geometry.boundingBox.isEmpty()) {
                            const b = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
                            meshBox.union(b);
                            foundMesh = true;
                        }
                    }
                });

                // Pega a maior medida válida entre os ossos e a malha (evita divisão por número minúsculo ou gigante)
                const boneSize = new THREE.Vector3();
                if (boneCount > 1) boneBox.getSize(boneSize);
                const meshSize = new THREE.Vector3();
                if (foundMesh) meshBox.getSize(meshSize);

                let height = Math.max(
                    isFinite(boneSize.y) ? boneSize.y : 0,
                    isFinite(meshSize.y) ? meshSize.y : 0
                );

                // Se veio em centímetros do Mixamo (ex: ~170), divide por 100 antes
                if (height > 20) {
                    height = height / 100.0;
                    rawScene.scale.multiplyScalar(0.01);
                }
                if (!isFinite(height) || height < 0.05) {
                    height = 1.8;
                }

                const scaleFactor = 2.15 / height;
                const wrapper = new THREE.Group();
                rawScene.scale.multiplyScalar(scaleFactor);
                wrapper.add(rawScene);

                // Recalcula base e centro no mundo já escalado
                wrapper.updateMatrixWorld(true);
                const finalBox = new THREE.Box3();
                rawScene.traverse(child => {
                    if (child.isBone) {
                        const pos = new THREE.Vector3();
                        child.getWorldPosition(pos);
                        finalBox.expandByPoint(pos);
                    } else if (child.isMesh && child.geometry && child.geometry.boundingBox) {
                        finalBox.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
                    }
                });

                // Calcula a base real tanto por vértices das malhas quanto por ossos para encostar os pés no asfalto (Y = 0)
                const trueGroundBox = new THREE.Box3();
                let hasTrueGround = false;

                rawScene.traverse(child => {
                    if (child.isMesh && child.geometry) {
                        const posAttr = child.geometry.attributes && child.geometry.attributes.position;
                        if (posAttr && posAttr.count > 0) {
                            const v = new THREE.Vector3();
                            for (let idx = 0; idx < posAttr.count; idx++) {
                                v.fromBufferAttribute(posAttr, idx).applyMatrix4(child.matrixWorld);
                                if (isFinite(v.y)) {
                                    trueGroundBox.expandByPoint(v);
                                    hasTrueGround = true;
                                }
                            }
                        } else {
                            child.geometry.computeBoundingBox();
                            if (child.geometry.boundingBox && !child.geometry.boundingBox.isEmpty()) {
                                trueGroundBox.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
                                hasTrueGround = true;
                            }
                        }
                    }
                });

                const groundBox = hasTrueGround ? trueGroundBox : finalBox;
                if (!groundBox.isEmpty() && isFinite(groundBox.min.y)) {
                    const center = new THREE.Vector3();
                    groundBox.getCenter(center);
                    rawScene.position.x = -center.x;
                    rawScene.position.z = -center.z;
                    // Pequeno ajuste (-0.02) ajuda a assentar o solado sem deixar vão visível no asfalto
                    rawScene.position.y = -groundBox.min.y - 0.02;
                }

                loadedGLBTemplates[charName] = {
                    scene: wrapper,
                    animations: gltf.animations || []
                };

                const statusEl = document.getElementById('glb-status');
                if (statusEl) {
                    const mappedStatus = mapGLBCharacterClips(gltf.animations || []);
                    const detected = ['run', 'jump', 'roll']
                        .filter(k => Boolean(mappedStatus[k]))
                        .map(k => k.toUpperCase());
                    statusEl.classList.add('active');
                    statusEl.innerHTML = `Modelo 3D <strong>${charName.toUpperCase()}.glb</strong> carregado! Animações: <strong>${detected.join(', ') || 'nenhuma'}</strong>`;
                }
                if (onModelReady) onModelReady(charName);
            },
            undefined,
            (err) => {
                console.warn(`Aviso ao carregar ${path}:`, err);
            }
        );
    });
}

function createJacketBackTexture(isLula) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = isLula ? '#dc2626' : '#15803d';
    ctx.fillRect(0, 0, 256, 256);

    ctx.save();
    ctx.translate(128, 102);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
        const outerAngle = (i * 72 - 90) * Math.PI / 180;
        const innerAngle = (i * 72 + 36 - 90) * Math.PI / 180;
        const ox = Math.cos(outerAngle) * 44;
        const oy = Math.sin(outerAngle) * 44;
        const ix = Math.cos(innerAngle) * 18;
        const iy = Math.sin(innerAngle) * 18;
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
        ctx.lineTo(ix, iy);
    }
    ctx.closePath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = isLula ? 'bold 34px Arial' : 'bold 26px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(isLula ? 'LULA' : 'BOLSONARO', 128, 185);

    return new THREE.CanvasTexture(canvas);
}

function createFaceTexture(isLula) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f2be96';
    ctx.fillRect(0, 0, 512, 512);

    ctx.fillStyle = 'rgba(214, 134, 96, 0.35)';
    ctx.beginPath();
    ctx.arc(175, 290, 42, 0, Math.PI * 2);
    ctx.arc(337, 290, 42, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(160, 92, 62, 0.45)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(205, 165); ctx.quadraticCurveTo(256, 158, 307, 165);
    ctx.moveTo(215, 182); ctx.quadraticCurveTo(256, 176, 297, 182);
    ctx.stroke();

    ctx.fillStyle = isLula ? '#e2e8f0' : '#3e2415';
    ctx.beginPath();
    ctx.roundRect(168, 200, 66, 16, 8);
    ctx.roundRect(278, 200, 66, 16, 8);
    ctx.fill();

    [202, 310].forEach(cx => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(cx, 238, 26, 20, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isLula ? '#4a2511' : '#1e3a8a';
        ctx.beginPath();
        ctx.arc(cx, 238, 13, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#090d16';
        ctx.beginPath();
        ctx.arc(cx, 238, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 4, 234, 3.5, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath();
    ctx.arc(256, 326, 46, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(256, 324, 42, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.lineTo(256, 336);
    ctx.closePath();
    ctx.fill();

    if (isLula) {
        ctx.fillStyle = '#f1f5f9';
        ctx.beginPath();
        ctx.arc(256, 345, 92, 0.05 * Math.PI, 0.95 * Math.PI);
        ctx.fill();

        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.ellipse(256, 316, 54, 16, 0, Math.PI, Math.PI * 2);
        ctx.fill();
    }

    return new THREE.CanvasTexture(canvas);
}

// Normaliza nomes de clipes exportados pelo Blender 5 (ex: "Run|Slot", "Jump.001", "Armature|Roll")
function normalizeGLBClipName(rawName = '') {
    return rawName
        .toLowerCase()
        .split('|')[0]
        .replace(/\.\d+$/, '')
        .trim();
}

function mapGLBCharacterClips(animations = []) {
    const mapped = {
        walk: null,
        run: null,
        left: null,
        right: null,
        jump: null,
        roll: null
    };

    for (const clip of animations) {
        const clean = normalizeGLBClipName(clip.name);
        if (!mapped.jump && (clean === 'jump' || clean.includes('jump') || clean.includes('pul'))) {
            mapped.jump = clip;
        } else if (
            !mapped.roll &&
            (clean === 'roll' ||
                clean.includes('roll') ||
                clean.includes('slide') ||
                clean.includes('crouch') ||
                clean.includes('agach'))
        ) {
            mapped.roll = clip;
        } else if (!mapped.left && (clean === 'left' || clean.includes('left') || clean.includes('esq') || clean.includes('strafeleft') || clean.includes('strafe_left'))) {
            mapped.left = clip;
        } else if (!mapped.right && (clean === 'right' || clean.includes('right') || clean.includes('dir') || clean.includes('straferight') || clean.includes('strafe_right'))) {
            mapped.right = clip;
        } else if (!mapped.walk && (clean === 'walk' || clean.includes('walk') || clean.includes('and'))) {
            mapped.walk = clip;
        } else if (!mapped.run && (clean === 'run' || clean.includes('run') || clean.includes('corr'))) {
            mapped.run = clip;
        }
    }

    if (!mapped.run && animations.length > 0) {
        mapped.run = animations.find(c => c !== mapped.jump && c !== mapped.roll && c !== mapped.walk) || animations[0];
    }
    if (!mapped.walk) {
        mapped.walk = mapped.run;
    }

    return mapped;
}

function createCharacterMesh(type) {
    const isLula = type === 'lula';

    if (loadedGLBTemplates[type]) {
        const root = new THREE.Group();
        const glbClone = cloneSkinnedScene(loadedGLBTemplates[type].scene);
        // Gira 180 graus (Math.PI) para o personagem parar de olhar para a câmera (+Z) e correr para a frente (-Z)
        glbClone.rotation.y = Math.PI;
        root.add(glbClone);

        let mixer = null;
        let actions = {};
        let currentAnimState = null;

        const playAnim = (stateName, fadeDuration = 0.14) => {
            if (!mixer) return;
            const nextAction = actions[stateName] || actions.run;
            if (!nextAction) return;
            if (currentAnimState === stateName && nextAction.isRunning()) return;

            const prevAction = actions[currentAnimState];
            currentAnimState = stateName;

            nextAction.reset();
            nextAction.enabled = true;
            nextAction.setEffectiveTimeScale(1);
            nextAction.setEffectiveWeight(1);

            if (prevAction && prevAction !== nextAction) {
                prevAction.crossFadeTo(nextAction, fadeDuration, false);
            }
            nextAction.play();
        };

        const rawAnims = loadedGLBTemplates[type].animations || [];
        if (rawAnims.length > 0) {
            mixer = new THREE.AnimationMixer(glbClone);
            const mapped = mapGLBCharacterClips(rawAnims);

            ['walk', 'run', 'left', 'right'].forEach(animKey => {
                if (mapped[animKey]) {
                    const act = mixer.clipAction(mapped[animKey]);
                    act.setLoop(THREE.LoopRepeat);
                    actions[animKey] = act;
                }
            });
            if (mapped.jump) {
                const jumpAction = mixer.clipAction(mapped.jump);
                jumpAction.setLoop(THREE.LoopOnce, 1);
                jumpAction.clampWhenFinished = true;
                actions.jump = jumpAction;
            }
            if (mapped.roll) {
                const rollAction = mixer.clipAction(mapped.roll);
                rollAction.setLoop(THREE.LoopOnce, 1);
                rollAction.clampWhenFinished = true;
                actions.roll = rollAction;
            }

            mixer.addEventListener('finished', (e) => {
                if (e.action === actions.jump || e.action === actions.roll) {
                    if (typeof isJumping !== 'undefined' && typeof isRolling !== 'undefined') {
                        if (!isJumping && !isRolling) {
                            playAnim('run', 0.12);
                        }
                    } else {
                        playAnim('run', 0.12);
                    }
                }
            });

            console.log(
                `[${type.toUpperCase()}.glb] Clipes:`,
                rawAnims.map(c => c.name),
                '-> Mapeados:',
                {
                    run: mapped.run ? mapped.run.name : null,
                    jump: mapped.jump ? mapped.jump.name : null,
                    roll: mapped.roll ? mapped.roll.name : null
                }
            );

            playAnim(actions.walk ? 'walk' : 'run', 0);
        }

        const boardGroup = createSkateboardMesh(isLula);
        root.add(boardGroup);

        const getClipDuration = (stateName) => {
            const act = actions[stateName];
            return (act && act.getClip()) ? act.getClip().duration : 0;
        };

        return {
            isGLB: true,
            mesh: root,
            glbModel: glbClone,
            mixer,
            actions,
            playAnim,
            getClipDuration,
            getCurrentAnimState: () => currentAnimState,
            board: boardGroup
        };
    }

    const root = new THREE.Group();
    const faceTex = createFaceTexture(isLula);
    const backTex = createJacketBackTexture(isLula);

    const headMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.45 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf2be96, roughness: 0.48 });
    const whiteHairMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.65 });
    const brownHairMat = new THREE.MeshStandardMaterial({ color: 0x452c1e, roughness: 0.58 });

    const jacketMat = new THREE.MeshStandardMaterial({
        color: isLula ? 0xdc2626 : 0x15803d,
        roughness: 0.42
    });
    const innerShirtMat = new THREE.MeshStandardMaterial({
        color: isLula ? 0x18181b : 0xfacc15,
        roughness: 0.55
    });
    const jeansMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.62 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0x713f12, roughness: 0.3 });
    const capBlueMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.45 });
    const yellowStripeMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.38 });
    const shoeMainMat = new THREE.MeshStandardMaterial({ color: isLula ? 0xf8fafc : 0x16a34a, roughness: 0.35 });
    const shoeAccentMat = new THREE.MeshStandardMaterial({ color: isLula ? 0xdc2626 : 0xfacc15, roughness: 0.4 });
    const soleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });

    const torsoGroup = new THREE.Group();
    torsoGroup.position.y = 1.15;
    root.add(torsoGroup);

    const innerChest = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.34, 0.78, 18), innerShirtMat);
    innerChest.scale.set(1.15, 1, 0.78);
    innerChest.castShadow = true;
    torsoGroup.add(innerChest);

    [-0.22, 0.22].forEach(xSide => {
        const jacketHalf = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.80, 14), jacketMat);
        jacketHalf.position.set(xSide, 0, 0.03);
        jacketHalf.scale.set(0.95, 1, 0.88);
        jacketHalf.castShadow = true;
        torsoGroup.add(jacketHalf);
    });

    const jacketBack = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.37, 0.80, 18), jacketMat);
    jacketBack.position.set(0, 0, -0.05);
    jacketBack.scale.set(1.18, 1, 0.76);
    jacketBack.castShadow = true;
    torsoGroup.add(jacketBack);

    const backPrintPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.56, 0.62),
        new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.45 })
    );
    backPrintPlane.position.set(0, 0.02, -0.335);
    backPrintPlane.rotation.y = Math.PI;
    torsoGroup.add(backPrintPlane);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.065, 10, 20), jacketMat);
    collar.rotation.x = Math.PI / 2 + 0.15;
    collar.position.set(0, 0.40, 0.02);
    torsoGroup.add(collar);

    const headGroup = new THREE.Group();
    headGroup.position.y = 0.88;
    torsoGroup.add(headGroup);

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.47, 28, 28), headMat);
    headMesh.rotation.y = -Math.PI / 2;
    headMesh.scale.set(0.95, 1.08, 0.96);
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 14), skinMat);
    nose.position.set(0, -0.02, 0.45);
    nose.scale.set(1.0, 0.95, 1.25);
    headGroup.add(nose);

    [-0.44, 0.44].forEach(xEar => {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), skinMat);
        ear.position.set(xEar, -0.02, -0.02);
        ear.scale.set(0.52, 1.1, 0.85);
        headGroup.add(ear);
    });

    if (isLula) {
        const beard3D = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 18), whiteHairMat);
        beard3D.position.set(0, -0.24, 0.07);
        beard3D.scale.set(1.04, 0.82, 1.02);
        headGroup.add(beard3D);

        const backHair = new THREE.Mesh(new THREE.SphereGeometry(0.47, 18, 18), whiteHairMat);
        backHair.position.set(0, 0.04, -0.09);
        headGroup.add(backHair);

        const capDome = new THREE.Mesh(
            new THREE.SphereGeometry(0.48, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56),
            capBlueMat
        );
        capDome.position.set(0, 0.14, -0.01);
        capDome.rotation.x = -0.12;
        headGroup.add(capDome);

        const visor = new THREE.Mesh(
            new THREE.CylinderGeometry(0.43, 0.45, 0.045, 20, 1, false, -Math.PI * 0.38, Math.PI * 0.76),
            capBlueMat
        );
        visor.position.set(0, 0.21, 0.25);
        visor.rotation.x = 0.15;
        headGroup.add(visor);

        const capStar = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.03, 5), goldMat);
        capStar.rotation.x = Math.PI / 2 - 0.25;
        capStar.position.set(0, 0.35, 0.42);
        headGroup.add(capStar);
    } else {
        const hairMain = new THREE.Mesh(
            new THREE.SphereGeometry(0.48, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
            brownHairMat
        );
        hairMain.position.set(0, 0.12, -0.04);
        hairMain.rotation.x = -0.18;
        headGroup.add(hairMain);

        const topete = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 14), brownHairMat);
        topete.position.set(-0.07, 0.43, 0.18);
        topete.scale.set(1.48, 0.65, 1.18);
        topete.rotation.z = -0.18;
        headGroup.add(topete);

        [-0.42, 0.42].forEach(xSide => {
            const sideburn = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.16), brownHairMat);
            sideburn.position.set(xSide, 0.12, 0.04);
            headGroup.add(sideburn);
        });
    }

    function makeArm(side) {
        const armPivot = new THREE.Group();
        armPivot.position.set(side * 0.46, 0.30, 0);

        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), jacketMat);
        armPivot.add(shoulder);

        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.10, 0.48, 12), jacketMat);
        sleeve.position.y = -0.24;
        sleeve.castShadow = true;
        armPivot.add(sleeve);

        if (!isLula) {
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.22), yellowStripeMat);
            stripe.position.set(side * 0.08, -0.24, 0);
            armPivot.add(stripe);
        }

        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.095, 0.08, 12), isLula ? jacketMat : yellowStripeMat);
        cuff.position.y = -0.48;
        armPivot.add(cuff);

        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), skinMat);
        hand.position.y = -0.56;
        armPivot.add(hand);

        return armPivot;
    }

    const leftArm = makeArm(-1);
    const rightArm = makeArm(1);
    torsoGroup.add(leftArm);
    torsoGroup.add(rightArm);

    function makeLeg(side) {
        const legPivot = new THREE.Group();
        legPivot.position.set(side * 0.19, 0.74, 0);

        const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.13, 0.56, 14), jeansMat);
        legMesh.position.y = -0.28;
        legMesh.castShadow = true;
        legPivot.add(legMesh);

        const shoeGroup = new THREE.Group();
        shoeGroup.position.set(0, -0.62, 0.07);
        legPivot.add(shoeGroup);

        const shoeUpper = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), shoeMainMat);
        shoeUpper.scale.set(0.95, 0.75, 1.55);
        shoeUpper.castShadow = true;
        shoeGroup.add(shoeUpper);

        const shoeBand = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.08, 0.22), shoeAccentMat);
        shoeBand.position.set(0, 0.02, 0.02);
        shoeGroup.add(shoeBand);

        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.52), soleMat);
        sole.position.set(0, -0.09, 0.01);
        shoeGroup.add(sole);

        return legPivot;
    }

    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);
    root.add(leftLeg);
    root.add(rightLeg);

    const boardGroup = createSkateboardMesh(isLula);
    root.add(boardGroup);

    root.rotation.y = Math.PI;
    return {
        isGLB: false,
        mesh: root,
        torso: torsoGroup,
        head: headGroup,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        board: boardGroup
    };
}

function createBanknoteTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 512, 256);
    grad.addColorStop(0, '#15803d');
    grad.addColorStop(0.5, '#22c55e');
    grad.addColorStop(1, '#166534');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, 484, 228);

    ctx.strokeStyle = 'rgba(254, 240, 138, 0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(28, 28, 456, 200);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.arc(256, 128, 72, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.font = '900 68px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R$ 100', 256, 124);

    ctx.fillStyle = '#dcfce7';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('BRASIL', 92, 66);
    ctx.fillText('100', 426, 66);
    ctx.fillText('100', 92, 194);
    ctx.fillText('BRASIL', 418, 194);

    const tex = new THREE.CanvasTexture(canvas);
    if (typeof THREE.sRGBEncoding !== 'undefined') {
        tex.encoding = THREE.sRGBEncoding;
    }
    return tex;
}

function createSkateboardMesh(isLula) {
    const boardGroup = new THREE.Group();
    boardGroup.position.set(0, 0.14, 0);
    boardGroup.visible = false;

    const deckColor = isLula ? 0xef4444 : 0x16a34a;
    const stripeColor = isLula ? 0x38bdf8 : 0xfacc15;

    const deckMat = new THREE.MeshStandardMaterial({
        color: deckColor,
        roughness: 0.28,
        metalness: 0.15
    });
    const gripMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.85
    });
    const stripeMat = new THREE.MeshStandardMaterial({
        color: stripeColor,
        roughness: 0.3,
        metalness: 0.25
    });
    const truckMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        metalness: 0.85,
        roughness: 0.2
    });
    const wheelMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        roughness: 0.35
    });

    // Shape central + bicos levantados (kicktails) do skate
    const mainDeck = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 1.45), deckMat);
    mainDeck.position.set(0, 0.04, 0);
    mainDeck.castShadow = true;
    boardGroup.add(mainDeck);

    const gripTop = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.02, 1.38), gripMat);
    gripTop.position.set(0, 0.085, 0);
    boardGroup.add(gripTop);

    const centerStripe = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.06, 0.28), stripeMat);
    centerStripe.position.set(0, 0.04, 0);
    boardGroup.add(centerStripe);

    const noseKick = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.36), deckMat);
    noseKick.position.set(0, 0.10, 0.84);
    noseKick.rotation.x = -0.32;
    noseKick.castShadow = true;
    boardGroup.add(noseKick);

    const tailKick = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.36), deckMat);
    tailKick.position.set(0, 0.10, -0.84);
    tailKick.rotation.x = 0.32;
    tailKick.castShadow = true;
    boardGroup.add(tailKick);

    // Trucks e 4 rodas bem visíveis
    [-0.52, 0.52].forEach(zTruck => {
        const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.82, 10), truckMat);
        axle.rotation.z = Math.PI / 2;
        axle.position.set(0, -0.04, zTruck);
        boardGroup.add(axle);

        const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.07, 0.10), truckMat);
        hanger.position.set(0, -0.02, zTruck);
        boardGroup.add(hanger);

        [-0.36, 0.36].forEach(xWheel => {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.12, 14), wheelMat);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(xWheel, -0.05, zTruck);
            wheel.castShadow = true;
            boardGroup.add(wheel);
        });
    });

    return boardGroup;
}

function createChaserGroup() {
    const group = new THREE.Group();

    const cop = new THREE.Group();
    const uniformMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.5 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf1c29b, roughness: 0.5 });
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.9, 14), uniformMat);
    body.position.y = 1.0;
    cop.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), skinMat);
    head.position.y = 1.72;
    cop.add(head);

    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.32, 0.22, 14), hatMat);
    hat.position.y = 2.02;
    cop.add(hat);

    group.add(cop);

    const dog = new THREE.Group();
    dog.position.set(0.85, 0, 0.2);
    const furMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
    const dogBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.75), furMat);
    dogBody.position.y = 0.42;
    dog.add(dogBody);

    const dogHead = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), furMat);
    dogHead.position.set(0, 0.65, -0.35);
    dog.add(dogHead);

    group.add(dog);

    return { group, cop, dog };
}

// =========================================================================
// 1. FIAT UNO MILLE QUADRADO (COM OPÇÃO DE ESCADA NO TETO!)
// =========================================================================
function addCarWheels(group, widthHalf, zPositions, radius = 0.36) {
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.75, roughness: 0.25 });
    zPositions.forEach(zPos => {
        [-widthHalf, widthHalf].forEach(xPos => {
            const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.24, 16), tireMat);
            tire.rotation.z = Math.PI / 2;
            tire.position.set(xPos, radius, zPos);
            tire.castShadow = true;
            group.add(tire);

            const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, 0.26, 12), rimMat);
            rim.rotation.z = Math.PI / 2;
            rim.position.set(xPos, radius, zPos);
            group.add(rim);
        });
    });
}

function createUnoMilleMesh() {
    const car = new THREE.Group();
    const withLadder = Math.random() < 0.65; // 65% de chance de ser o lendário Uno com escada no teto!
    const colors = withLadder ? [0xf8fafc] : [0xdc2626, 0xf8fafc, 0x2563eb, 0x94a3b8];
    const paintColor = colors[Math.floor(Math.random() * colors.length)];

    const paintMat = new THREE.MeshStandardMaterial({ color: paintColor, metalness: 0.3, roughness: 0.28 });
    const plasticMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85, roughness: 0.08 });
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const taillightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    // Carroceria quadrada inferior
    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.68, 4.15), paintMat);
    lowerBody.position.set(0, 0.64, 0);
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    car.add(lowerBody);

    // Capô inclinado clássico do Uno Mille
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.22, 1.05), paintMat);
    hood.position.set(0, 0.94, 1.48);
    hood.rotation.x = 0.14;
    hood.castShadow = true;
    car.add(hood);

    // Cabine quadrada traseira (hatchback)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.68, 2.75), paintMat);
    cabin.position.set(0, 1.28, -0.52);
    cabin.castShadow = true;
    car.add(cabin);

    // Para-brisa inclinado
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.64, 0.08), glassMat);
    windshield.position.set(0, 1.26, 0.96);
    windshield.rotation.x = -0.42;
    car.add(windshield);

    // Vidros laterais e traseiro
    const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(1.81, 0.52, 2.35), glassMat);
    sideGlass.position.set(0, 1.30, -0.52);
    car.add(sideGlass);

    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.50, 0.08), glassMat);
    rearGlass.position.set(0, 1.30, -1.90);
    rearGlass.rotation.x = 0.16;
    car.add(rearGlass);

    // Para-choques preto fosco característico do Uno Mille
    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.28, 0.25), plasticMat);
    frontBumper.position.set(0, 0.44, 2.08);
    car.add(frontBumper);

    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.28, 0.25), plasticMat);
    rearBumper.position.set(0, 0.44, -2.08);
    car.add(rearBumper);

    // Grade frontal preta + Faróis quadrados
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.24, 0.08), plasticMat);
    grille.position.set(0, 0.72, 2.07);
    car.add(grille);

    [-0.68, 0.68].forEach(x => {
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.08), headlightMat);
        hl.position.set(x, 0.72, 2.07);
        car.add(hl);

        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.08), taillightMat);
        tl.position.set(x, 0.75, -2.07);
        car.add(tl);
    });

    // ESCADA NO TETO (Modo Turbo Brasil!)
    if (withLadder) {
        const rackMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 });
        const ladderMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.25 });

        [-1.3, 0.2].forEach(zRack => {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 0.08), rackMat);
            bar.position.set(0, 1.65, zRack);
            car.add(bar);
        });

        // Trilhos laterais da escada
        [-0.36, 0.36].forEach(xRail => {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 3.3), ladderMat);
            rail.position.set(xRail, 1.74, -0.45);
            car.add(rail);
        });

        // Degraus da escada
        for (let zStep = -1.9; zStep <= 1.0; zStep += 0.36) {
            const step = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8), ladderMat);
            step.rotation.z = Math.PI / 2;
            step.position.set(0, 1.74, zStep);
            car.add(step);
        }
    }

    addCarWheels(car, 0.92, [-1.32, 1.32], 0.34);
    return car;
}

// =========================================================================
// 2. VOLKSWAGEN FUSCA CLÁSSICO (CURVAS ARREDONDADAS + FARÓIS REDONDOS)
// =========================================================================
function createFuscaMesh() {
    const car = new THREE.Group();
    const colors = [0x0284c7, 0xfacc15, 0xf8fafc, 0x16a34a, 0xdc2626];
    const paintColor = colors[Math.floor(Math.random() * colors.length)];

    const paintMat = new THREE.MeshStandardMaterial({ color: paintColor, metalness: 0.35, roughness: 0.24 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.9, roughness: 0.15 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85, roughness: 0.08 });
    const runningBoardMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const taillightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    // Plataforma e estribos laterais
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.36, 4.15), paintMat);
    chassis.position.set(0, 0.48, 0);
    chassis.castShadow = true;
    car.add(chassis);

    [-0.98, 0.98].forEach(xStep => {
        const step = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 1.85), runningBoardMat);
        step.position.set(xStep, 0.36, 0);
        car.add(step);
    });

    // Casco arredondado (cúpula central clássica do Fusca)
    const domeGeo = new THREE.SphereGeometry(1.05, 24, 18);
    const dome = new THREE.Mesh(domeGeo, paintMat);
    dome.scale.set(0.86, 0.92, 1.55);
    dome.position.set(0, 0.95, -0.1);
    dome.castShadow = true;
    car.add(dome);

    // Capô dianteiro arredondado
    const frontHood = new THREE.Mesh(new THREE.SphereGeometry(0.88, 20, 14), paintMat);
    frontHood.scale.set(0.88, 0.62, 1.15);
    frontHood.position.set(0, 0.68, 1.25);
    frontHood.castShadow = true;
    car.add(frontHood);

    // Capô traseiro do motor
    const rearHood = new THREE.Mesh(new THREE.SphereGeometry(0.88, 20, 14), paintMat);
    rearHood.scale.set(0.88, 0.65, 1.05);
    rearHood.position.set(0, 0.72, -1.35);
    rearHood.castShadow = true;
    car.add(rearHood);

    // 4 Para-lamas arredondados externos
    [[-0.84, 1.28], [0.84, 1.28], [-0.84, -1.28], [0.84, -1.28]].forEach(([fx, fz]) => {
        const fender = new THREE.Mesh(
            new THREE.CylinderGeometry(0.48, 0.48, 0.34, 16, 1, false, 0, Math.PI),
            paintMat
        );
        fender.rotation.z = Math.PI / 2;
        fender.rotation.y = Math.PI / 2;
        fender.position.set(fx, 0.44, fz);
        fender.castShadow = true;
        car.add(fender);
    });

    // Para-brisa e vigia traseiro
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.48, 0.08), glassMat);
    windshield.position.set(0, 1.32, 0.88);
    windshield.rotation.x = -0.35;
    car.add(windshield);

    const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.42, 0.08), glassMat);
    rearWin.position.set(0, 1.32, -1.05);
    rearWin.rotation.x = 0.45;
    car.add(rearWin);

    // Faróis redondos nos para-lamas dianteiros
    [-0.76, 0.76].forEach(x => {
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.14, 16), chromeMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(x, 0.76, 1.88);
        car.add(rim);

        const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), headlightMat);
        bulb.position.set(x, 0.76, 1.96);
        car.add(bulb);

        const tail = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), taillightMat);
        tail.position.set(x, 0.72, -1.92);
        car.add(tail);
    });

    // Para-choques cromados dianteiro e traseiro
    [2.12, -2.12].forEach(zBumper => {
        const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.14, 0.12), chromeMat);
        bumper.position.set(0, 0.44, zBumper);
        car.add(bumper);
    });

    addCarWheels(car, 0.88, [-1.28, 1.28], 0.36);
    return car;
}

// =========================================================================
// 3. VOLKSWAGEN KOMBI CLÁSSICA ("SAIA E BLUSA" BRANCA & AZUL/VERDE/LARANJA)
// =========================================================================
function createKombiMesh() {
    const van = new THREE.Group();
    const lowerColors = [0x0284c7, 0x16a34a, 0xea580c, 0xdc2626, 0xeab308];
    const skirtColor = lowerColors[Math.floor(Math.random() * lowerColors.length)];

    const topMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.25, roughness: 0.28 });
    const skirtMat = new THREE.MeshStandardMaterial({ color: skirtColor, metalness: 0.25, roughness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85, roughness: 0.08 });
    const bumperMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4 });
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const emblemMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.15 });

    const width = 2.08;
    const length = 4.95;

    // Parte inferior ("Saia" colorida)
    const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(width, 0.82, length), skirtMat);
    lowerHull.position.set(0, 0.78, 0);
    lowerHull.castShadow = true;
    lowerHull.receiveShadow = true;
    van.add(lowerHull);

    // Parte superior ("Blusa" branca)
    const upperHull = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, 0.92, length - 0.08), topMat);
    upperHull.position.set(0, 1.65, 0);
    upperHull.castShadow = true;
    van.add(upperHull);

    // Teto levemente abaulado
    const roof = new THREE.Mesh(new THREE.BoxGeometry(width - 0.18, 0.16, length - 0.24), topMat);
    roof.position.set(0, 2.16, 0);
    van.add(roof);

    // Frente plana clássica com o "V" frontal da Kombi Corujinha
    const frontV = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.78, 3), topMat);
    frontV.rotation.x = Math.PI;
    frontV.position.set(0, 0.85, length / 2 + 0.01);
    frontV.scale.set(1.1, 1, 0.06);
    van.add(frontV);

    // Emblema redondo na frente
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 18), emblemMat);
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, 0.95, length / 2 + 0.03);
    van.add(badge);

    // Para-brisa bipartido e janelas laterais panorâmicas
    const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(width - 0.28, 0.62, 0.08), glassMat);
    frontGlass.position.set(0, 1.68, length / 2 - 0.01);
    van.add(frontGlass);

    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.64, 0.10), topMat);
    pillar.position.set(0, 1.68, length / 2 + 0.01);
    van.add(pillar);

    // Janelas laterais em sequência
    [-1.4, 0, 1.4].forEach(zWin => {
        const sideWin = new THREE.Mesh(new THREE.BoxGeometry(width + 0.02, 0.58, 1.15), glassMat);
        sideWin.position.set(0, 1.68, zWin);
        van.add(sideWin);
    });

    // Faróis redondos dianteiros + Para-choques brancos
    [-0.68, 0.68].forEach(x => {
        const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 16), headlightMat);
        hl.rotation.x = Math.PI / 2;
        hl.position.set(x, 0.78, length / 2 + 0.02);
        van.add(hl);
    });

    [length / 2 + 0.06, -length / 2 - 0.06].forEach(zB => {
        const bumper = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, 0.22, 0.16), bumperMat);
        bumper.position.set(0, 0.44, zB);
        van.add(bumper);
    });

    addCarWheels(van, 0.98, [-1.52, 1.52], 0.38);
    return van;
}

// =========================================================================
// 4. TÁXI AMARELO DO RIO DE JANEIRO (COM FAIXA AZUL E LUMINOSO "TÁXI")
// =========================================================================
function createRioTaxiMesh() {
    const taxi = new THREE.Group();
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.3, roughness: 0.25 });
    const blueStripeMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.35 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85, roughness: 0.08 });
    const bumperMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
    const signMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

    // Sedan carioca
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.66, 4.45), yellowMat);
    body.position.set(0, 0.64, 0);
    body.castShadow = true;
    taxi.add(body);

    // Faixa azul lateral icônica dos táxis do Rio
    const blueStripe = new THREE.Mesh(new THREE.BoxGeometry(1.97, 0.14, 4.47), blueStripeMat);
    blueStripe.position.set(0, 0.72, 0);
    taxi.add(blueStripe);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.62, 2.35), yellowMat);
    cabin.position.set(0, 1.24, -0.15);
    cabin.castShadow = true;
    taxi.add(cabin);

    const cabinGlass = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.50, 2.15), glassMat);
    cabinGlass.position.set(0, 1.25, -0.15);
    taxi.add(cabinGlass);

    // Luminoso "TÁXI" no teto
    const taxiSign = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.22, 0.26), signMat);
    taxiSign.position.set(0, 1.65, 0.05);
    taxi.add(taxiSign);

    [2.24, -2.24].forEach(zB => {
        const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.24, 0.18), bumperMat);
        bumper.position.set(0, 0.45, zB);
        taxi.add(bumper);
    });

    [-0.68, 0.68].forEach(x => {
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.08), headlightMat);
        hl.position.set(x, 0.72, 2.24);
        taxi.add(hl);
    });

    addCarWheels(taxi, 0.94, [-1.42, 1.42], 0.35);
    return taxi;
}

// =========================================================================
// 5. CACHORRO CARAMELO BRASILEIRO (ATRAVESSANDO A RUA ANIMADO!)
// =========================================================================
function createCarameloDogMesh() {
    const dogGroup = new THREE.Group();

    const carameloMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.65 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.7 });
    const snoutMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.5 });
    const collarMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x090d16 });

    // Tronco do Caramelo (orientado no eixo +X para atravessar as faixas)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.85, 14), carameloMat);
    torso.rotation.z = Math.PI / 2;
    torso.position.set(0, 0.54, 0);
    torso.castShadow = true;
    dogGroup.add(torso);

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 14), bellyMat);
    chest.position.set(0.36, 0.54, 0);
    dogGroup.add(chest);

    // Coleira vermelha
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.04, 8, 16), collarMat);
    collar.rotation.y = Math.PI / 2;
    collar.position.set(0.42, 0.64, 0);
    dogGroup.add(collar);

    // Cabeça expressiva
    const headGroup = new THREE.Group();
    headGroup.position.set(0.56, 0.78, 0);
    dogGroup.add(headGroup);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), carameloMat);
    skull.castShadow = true;
    headGroup.add(skull);

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.16), bellyMat);
    muzzle.position.set(0.18, -0.04, 0);
    headGroup.add(muzzle);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), snoutMat);
    nose.position.set(0.30, 0.01, 0);
    headGroup.add(nose);

    // Olhinhos e orelhas dobradas típicas de vira-lata caramelo
    [-0.12, 0.12].forEach(zSide => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat);
        eye.position.set(0.18, 0.08, zSide);
        headGroup.add(eye);

        const ear = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.06), carameloMat);
        ear.position.set(-0.04, 0.16, zSide * 1.35);
        ear.rotation.x = zSide > 0 ? 0.35 : -0.35;
        ear.rotation.z = 0.25;
        headGroup.add(ear);
    });

    // Rabo abanando para cima
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.38, 8), carameloMat);
    tail.position.set(-0.52, 0.72, 0);
    tail.rotation.z = 0.65;
    dogGroup.add(tail);

    // 4 Patinhas articuladas para animar a corrida
    const legs = [];
    [[0.30, 0.14], [0.30, -0.14], [-0.30, 0.14], [-0.30, -0.14]].forEach(([lx, lz]) => {
        const legPivot = new THREE.Group();
        legPivot.position.set(lx, 0.42, lz);
        const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.42, 10), carameloMat);
        legMesh.position.y = -0.21;
        legMesh.castShadow = true;
        legPivot.add(legMesh);
        dogGroup.add(legPivot);
        legs.push(legPivot);
    });

    dogGroup.userData = { legs, tail, headGroup };
    return dogGroup;
}

// =========================================================================
// 6. BARREIRAS URBANAS (CAVALETE BAIXO & FAIXA ALTA DE RUA)
// =========================================================================
function createBarrierMesh(high = false) {
    const group = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.75 });
    const orangeMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.4 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 });

    const postHeight = high ? 2.7 : 1.15;
    [-1.0, 1.0].forEach(x => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, postHeight, 0.18), woodMat);
        post.position.set(x, postHeight / 2, 0);
        post.castShadow = true;
        group.add(post);
    });

    const boardY = high ? 2.15 : 0.85;
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 0.16), orangeMat);
    board.position.set(0, boardY, 0);
    board.castShadow = true;
    group.add(board);

    [-0.65, 0, 0.65].forEach(x => {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.57, 0.18), whiteMat);
        stripe.position.set(x, boardY, 0);
        group.add(stripe);
    });

    return group;
}

let sharedBanknoteTex = null;

function createCoinMesh() {
    if (!sharedBanknoteTex) {
        sharedBanknoteTex = createBanknoteTexture();
    }
    const billGroup = new THREE.Group();

    const billMat = new THREE.MeshStandardMaterial({
        map: sharedBanknoteTex,
        emissive: 0x14532d,
        emissiveIntensity: 0.22,
        roughness: 0.38,
        metalness: 0.08,
        side: THREE.DoubleSide
    });
    const edgeMat = new THREE.MeshStandardMaterial({
        color: 0x86efac,
        roughness: 0.5
    });

    const noteMesh = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.48, 0.025), billMat);
    noteMesh.castShadow = true;
    billGroup.add(noteMesh);

    const band = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.49, 0.032), edgeMat);
    band.position.x = 0.24;
    billGroup.add(band);

    return billGroup;
}

function createSkatePickupMesh() {
    const group = new THREE.Group();

    const deckMat = new THREE.MeshStandardMaterial({
        color: 0xf97316,
        emissive: 0x7c2d12,
        emissiveIntensity: 0.25,
        roughness: 0.3,
        metalness: 0.2
    });
    const gripMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.85
    });
    const truckMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        metalness: 0.85,
        roughness: 0.2
    });
    const wheelMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0369a1,
        emissiveIntensity: 0.2,
        roughness: 0.35
    });

    const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 1.38), deckMat);
    board.castShadow = true;
    group.add(board);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.02, 1.30), gripMat);
    grip.position.y = 0.045;
    group.add(grip);

    [-0.46, 0.46].forEach(zPos => {
        const truck = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.10), truckMat);
        truck.position.set(0, -0.05, zPos);
        group.add(truck);

        [-0.32, 0.32].forEach(xPos => {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.11, 12), wheelMat);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(xPos, -0.07, zPos);
            group.add(wheel);
        });
    });

    group.rotation.x = 0.35;
    group.rotation.z = 0.25;
    return group;
}

// Horizonte Realista do Rio de Janeiro
function buildRioBackground(scene) {
    const bgGroup = new THREE.Group();

    const graniteMat = new THREE.MeshStandardMaterial({
        color: 0x57534e,
        roughness: 0.88,
        metalness: 0.05
    });
    const forestMat = new THREE.MeshStandardMaterial({
        color: 0x14532d,
        roughness: 0.92
    });

    const sugarPoints = [
        new THREE.Vector2(0, 56),
        new THREE.Vector2(5, 55),
        new THREE.Vector2(11, 50),
        new THREE.Vector2(16, 40),
        new THREE.Vector2(21, 26),
        new THREE.Vector2(27, 10),
        new THREE.Vector2(34, 0)
    ];
    const sugarLoaf = new THREE.Mesh(new THREE.LatheGeometry(sugarPoints, 28), graniteMat);
    sugarLoaf.scale.set(1.15, 1.0, 0.85);
    sugarLoaf.position.set(56, -2, -162);
    bgGroup.add(sugarLoaf);

    const urcaPoints = [
        new THREE.Vector2(0, 32),
        new THREE.Vector2(9, 30),
        new THREE.Vector2(18, 22),
        new THREE.Vector2(26, 10),
        new THREE.Vector2(32, 0)
    ];
    const urcaHill = new THREE.Mesh(new THREE.LatheGeometry(urcaPoints, 24), forestMat);
    urcaHill.position.set(26, -2, -152);
    bgGroup.add(urcaHill);

    const cableGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(26, 28, -152),
        new THREE.Vector3(56, 51, -162)
    ]);
    const cable = new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: 0x1e293b }));
    bgGroup.add(cable);

    const cableCar = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 1.6, 1.4),
        new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.4, roughness: 0.3 })
    );
    cableCar.position.set(41, 39.5, -157);
    bgGroup.add(cableCar);

    const corcovadoPoints = [
        new THREE.Vector2(0, 62),
        new THREE.Vector2(8, 59),
        new THREE.Vector2(19, 46),
        new THREE.Vector2(30, 26),
        new THREE.Vector2(42, 0)
    ];
    const corcovado = new THREE.Mesh(new THREE.LatheGeometry(corcovadoPoints, 26), forestMat);
    corcovado.position.set(-54, -2, -172);
    bgGroup.add(corcovado);

    const christGroup = new THREE.Group();
    christGroup.position.set(-54, 59, -172);
    const statueMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.45 });

    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.6, 4.2), statueMat);
    christGroup.add(pedestal);

    const robe = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.5, 10.5, 14), statueMat);
    robe.position.y = 6.8;
    christGroup.add(robe);

    const arms = new THREE.Mesh(new THREE.BoxGeometry(12.2, 1.35, 1.35), statueMat);
    arms.position.y = 10.4;
    christGroup.add(arms);

    const head = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 12), statueMat);
    head.position.y = 12.6;
    christGroup.add(head);

    bgGroup.add(christGroup);

    const sandMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.96 });
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(46, 280), sandMat);
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(34, -0.05, -75);
    bgGroup.add(sand);

    const foamMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 280), foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(55.5, -0.04, -75);
    bgGroup.add(foam);

    const seaMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        roughness: 0.16,
        metalness: 0.55
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(220, 320), seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(165, -0.08, -80);
    bgGroup.add(sea);

    // Faixas de ondas animadas no mar do Rio
    const waveMat = new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        roughness: 0.3,
        transparent: true,
        opacity: 0.68
    });
    const waveStripes = [];
    for (let w = 0; w < 5; w++) {
        const wave = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 280), waveMat);
        wave.rotation.x = -Math.PI / 2;
        wave.position.set(59 + w * 9.5, -0.05, -80);
        bgGroup.add(wave);
        waveStripes.push({ mesh: wave, baseX: 59 + w * 9.5, phase: w * 1.1 });
    }

    // Mureta / guarda-corpo clássico da orla entre calçadão e areia
    const railMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 });
    const railGroup = new THREE.Group();
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 280), railMat);
    topRail.position.set(12.2, 0.85, -75);
    railGroup.add(topRail);
    for (let zPost = 25; zPost >= -210; zPost -= 6) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.85, 0.18), railMat);
        post.position.set(12.2, 0.42, zPost);
        railGroup.add(post);
    }
    bgGroup.add(railGroup);

    // Pedra da Gávea / Dois Irmãos ao fundo distante para dar profundidade de horizonte carioca
    const doisIrmaosMat = new THREE.MeshStandardMaterial({ color: 0x1e3a2f, roughness: 0.9 });
    [[-18, 36, -185, 22], [6, 31, -185, 19]].forEach(([bx, bh, bz, br]) => {
        const pts = [
            new THREE.Vector2(0, bh),
            new THREE.Vector2(br * 0.22, bh * 0.92),
            new THREE.Vector2(br * 0.65, bh * 0.52),
            new THREE.Vector2(br, 0)
        ];
        const peak = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), doisIrmaosMat);
        peak.position.set(bx, -2, bz);
        bgGroup.add(peak);
    });

    scene.add(bgGroup);
    return { cableCar, waveStripes };
}

function createCoconutCartMesh() {
    const cart = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.45 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8, roughness: 0.25 });

    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.82, 0.72), bodyMat);
    tub.position.set(0, 0.68, 0);
    tub.castShadow = true;
    cart.add(tub);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.16, 0.75), greenMat);
    stripe.position.set(0, 0.85, 0);
    cart.add(stripe);

    // Pilha de cocos verdes no topo
    const coconutMat = new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.65 });
    [[-0.22, 1.18, 0], [0.22, 1.18, 0], [0, 1.42, 0]].forEach(([cx, cy, cz]) => {
        const coco = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), coconutMat);
        coco.scale.set(0.95, 1.15, 0.95);
        coco.position.set(cx, cy, cz);
        coco.castShadow = true;
        cart.add(coco);
    });

    // Rodinhas do carrinho
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    [-0.42, 0.42].forEach(wx => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12), wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.18, 0.34);
        cart.add(wheel);
    });

    // Cabo de empurrar
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.85), metalMat);
    handle.position.set(0, 0.92, -0.68);
    handle.rotation.x = 0.25;
    cart.add(handle);

    return cart;
}


// =========================================================================
// 7. BURACO NA RUA COM PLACA LARANJA ("HOMENS TRABALHANDO")
// =========================================================================
function createRoadHoleMesh() {
    const group = new THREE.Group();

    const holeMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.95 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.6, roughness: 0.4 });
    const signBgMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4 });

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.24, 0.05, 20), rimMat);
    rim.position.set(0, 0.02, 0);
    rim.scale.set(1.0, 1.0, 1.35);
    group.add(rim);

    const hole = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 0.85, 0.08, 20), holeMat);
    hole.position.set(0, 0.03, 0);
    hole.scale.set(1.0, 1.0, 1.35);
    group.add(hole);

    // Placa laranja inclinada na lateral/traseira
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.55, 8), poleMat);
    post.position.set(1.15, 0.77, -0.55);
    post.castShadow = true;
    group.add(post);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f97316';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 12;
    ctx.strokeRect(10, 10, 236, 236);
    ctx.fillStyle = '#111827';
    ctx.font = '900 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HOMENS', 128, 105);
    ctx.fillText('TRABALHANDO', 128, 145);
    ctx.font = '700 20px sans-serif';
    ctx.fillText('OBRA NA PISTA', 128, 185);

    const signTex = new THREE.CanvasTexture(canvas);
    signTex.encoding = THREE.sRGBEncoding;
    const signBoard = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.95, 0.06),
        [signBgMat, signBgMat, signBgMat, signBgMat, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.45 }), signBgMat]
    );
    signBoard.position.set(1.15, 1.38, -0.55);
    signBoard.rotation.y = -0.25;
    signBoard.castShadow = true;
    group.add(signBoard);

    return group;
}

// =========================================================================
// 8. MOTO COM ENTREGADOR APRESSADO CORTANDO O TRÂNSITO
// =========================================================================
function createDeliveryMotoMesh() {
    const group = new THREE.Group();

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.5 });
    const fairingMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35 });
    const bagMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 });
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 });
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 1.55), frameMat);
    chassis.position.set(0, 0.55, 0);
    chassis.castShadow = true;
    group.add(chassis);

    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.65), fairingMat);
    tank.position.set(0, 0.82, 0.22);
    tank.castShadow = true;
    group.add(tank);

    const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), headlightMat);
    headlight.position.set(0, 0.92, 0.82);
    group.add(headlight);

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });
    [0.65, -0.62].forEach(wz => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 14), wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(0, 0.32, wz);
        wheel.castShadow = true;
        group.add(wheel);
    });

    // Mochila de entrega (bag)
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.46), bagMat);
    bag.position.set(0, 1.08, -0.55);
    bag.castShadow = true;
    group.add(bag);

    // Entregador + capacete
    const riderTorso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.28), jacketMat);
    riderTorso.position.set(0, 1.18, -0.08);
    riderTorso.rotation.x = 0.22;
    riderTorso.castShadow = true;
    group.add(riderTorso);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 14), helmetMat);
    helmet.position.set(0, 1.62, 0.04);
    helmet.castShadow = true;
    group.add(helmet);

    return group;
}

// =========================================================================
// 9. CARRO DA POLÍCIA COM GIROFLEX / PISCA LIGADO
// =========================================================================
function createPoliceCarMesh() {
    const group = new THREE.Group();

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.28, metalness: 0.2 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.8 });
    const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });
    const blueLightMat = new THREE.MeshBasicMaterial({ color: 0x1d4ed8 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.72, 4.1), whiteMat);
    body.position.set(0, 0.64, 0);
    body.castShadow = true;
    group.add(body);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.91, 0.22, 4.12), darkMat);
    stripe.position.set(0, 0.68, 0);
    group.add(stripe);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.58, 2.05), glassMat);
    cabin.position.set(0, 1.24, -0.15);
    cabin.castShadow = true;
    group.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.08, 1.65), whiteMat);
    roof.position.set(0, 1.54, -0.15);
    group.add(roof);

    addCarWheels(group, 0.94, [1.28, -1.28], 0.36);

    // Barra de giroflex (vermelho e azul)
    const lightBarGroup = new THREE.Group();
    lightBarGroup.position.set(0, 1.66, -0.15);

    const redLamp = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.18, 0.28), redLightMat);
    redLamp.position.set(-0.32, 0, 0);
    lightBarGroup.add(redLamp);

    const blueLamp = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.18, 0.28), blueLightMat);
    blueLamp.position.set(0.32, 0, 0);
    lightBarGroup.add(blueLamp);

    group.add(lightBarGroup);
    group.userData = { redLamp, blueLamp, lightBarGroup };

    return group;
}
