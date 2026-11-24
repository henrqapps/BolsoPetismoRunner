// Motor Principal Rio Surfers 3D - Versão 5 (Carros Brasileiros + Cachorro Caramelo)

const LANES = [-2.8, 0, 2.8];
const GRAVITY = -38;
const JUMP_FORCE = 12.2;

let scene, camera, renderer;
let playerObj, chaserObj, rioProps;
let selectedChar = 'lula';
window.selectedChar = selectedChar;

let gameState = 'MENU';
let currentLane = 1;
let playerX = 0;
let playerY = 0;
let velocityY = 0;
let isJumping = false;
let isRolling = false;
let rollTimer = 0;
let strafeAnim = null; // 'left' | 'right' | null
let strafeTimer = 0;
let currentLocomotion = 'walk'; // 'walk' | 'run'
const WALK_START_SPEED = 7.8;
const RUN_SPEED_THRESHOLD = 16.5; // A partir dessa velocidade o personagem passa a correr (run)
let hasSkate = false;
let skateTimer = 0;
const SKATE_DURATION = 10;

let baseSpeed = 7.8;
let speed = 7.8;
let maxSpeed = 48;
let score = 0;
let coins = 0;
let bestScore = parseInt(localStorage.getItem('rio_surfers_best') || '0', 10);
let distanceSinceLastSpawn = 0;
let runAnimTime = 0;

let roadSegments = [];
let cityBuildings = [];
let obstacles = [];
let collectibles = [];

const clock = new THREE.Clock();

function init() {
    const container = document.getElementById('game-container');

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xbae6fd, 0.0052);

    camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 250);
    camera.position.set(0, 5.2, 9.2);
    camera.lookAt(0, 1.8, -8);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    if (typeof THREE.RoomEnvironment !== 'undefined') {
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        scene.environment = pmremGenerator.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    }

    scene.fog = new THREE.FogExp2(0xfcd34d, 0.0044);

    const hemiLight = new THREE.HemisphereLight(0xfde68a, 0x334155, 0.72);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffedd5, 1.55);
    sunLight.position.set(34, 24, -45);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far = 110;
    const d = 30;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    createRioSkyDome(scene);
    rioProps = buildRioBackground(scene);
    initRioStreetEnvironment();

    spawnPlayer(selectedChar);

    preloadExternalGLBModels((loadedName) => {
        if (loadedName === selectedChar) {
            spawnPlayer(selectedChar);
        }
    });

    chaserObj = createChaserGroup();
    chaserObj.group.position.set(0, 0, 3.6);
    scene.add(chaserObj.group);

    setupEvents();
    animate();
}

function initRioStreetEnvironment() {
    const asphaltPBR = createPBRAsphaltTextures();
    const sidewalkPBR = createPBRCopacabanaSidewalkTextures();

    const roadMat = new THREE.MeshStandardMaterial({
        map: asphaltPBR.map,
        bumpMap: asphaltPBR.bumpMap,
        bumpScale: 0.04,
        roughness: 0.82,
        metalness: 0.05
    });

    const sidewalkMat = new THREE.MeshStandardMaterial({
        map: sidewalkPBR.map,
        bumpMap: sidewalkPBR.bumpMap,
        bumpScale: 0.05,
        roughness: 0.78
    });

    const bikeLaneMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.75 });

    for (let i = 0; i < 14; i++) {
        const seg = new THREE.Group();
        seg.position.z = -i * 15 + 15;

        const road = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.5, 15), roadMat);
        road.position.y = -0.25;
        road.receiveShadow = true;
        seg.add(road);

        const rightSidewalk = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.68, 15), sidewalkMat);
        rightSidewalk.position.set(8.05, -0.22, 0);
        rightSidewalk.receiveShadow = true;
        seg.add(rightSidewalk);

        const bikeLane = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.69, 15), bikeLaneMat);
        bikeLane.position.set(11.4, -0.22, 0);
        seg.add(bikeLane);

        const leftSidewalk = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.68, 15), sidewalkMat);
        leftSidewalk.position.set(-8.05, -0.22, 0);
        leftSidewalk.receiveShadow = true;
        seg.add(leftSidewalk);

        scene.add(seg);
        roadSegments.push(seg);
    }

    const buildingPalettes = [
        ['#f8fafc', '#cbd5e1', '#0284c7'],
        ['#fef3c7', '#fde68a', '#b45309'],
        ['#f1f5f9', '#94a3b8', '#15803d'],
        ['#ffedd5', '#fed7aa', '#b91c1c'],
        ['#e2e8f0', '#cbd5e1', '#1e3a8a']
    ];

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.92 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.55 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.25 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });

    for (let i = 0; i < 16; i++) {
        const zPos = -i * 12 + 15;
        const rowGroup = new THREE.Group();
        rowGroup.position.set(0, 0, zPos);

        const [wallCol, trimCol, awnCol] = buildingPalettes[i % buildingPalettes.length];
        const bPBR = createPBRBuildingTextures(wallCol, trimCol, awnCol);
        const bHeight = 16 + (i % 4) * 3.8;
        const bWidth = 8.8;
        const bDepth = 11.4;

        const buildingMat = new THREE.MeshStandardMaterial({
            map: bPBR.map,
            roughnessMap: bPBR.roughnessMap,
            roughness: 1.0,
            metalness: 0.15
        });
        const building = new THREE.Mesh(new THREE.BoxGeometry(bWidth, bHeight, bDepth), buildingMat);
        building.position.set(-14.8, bHeight / 2 + 0.1, 0);
        building.castShadow = true;
        building.receiveShadow = true;
        rowGroup.add(building);

        const roofTrim = new THREE.Mesh(
            new THREE.BoxGeometry(bWidth + 0.35, 0.55, bDepth + 0.35),
            new THREE.MeshStandardMaterial({ color: trimCol, roughness: 0.7 })
        );
        roofTrim.position.set(-14.8, bHeight + 0.3, 0);
        rowGroup.add(roofTrim);

        [-5.7, 5.7].forEach(xPole => {
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 5.8, 10), poleMat);
            pole.position.set(xPole, 2.9, 0);
            pole.castShadow = true;
            rowGroup.add(pole);

            const arm = new THREE.Mesh(new THREE.BoxGeometry(xPole < 0 ? 1.4 : -1.4, 0.08, 0.08), poleMat);
            arm.position.set(xPole + (xPole < 0 ? 0.6 : -0.6), 5.7, 0);
            rowGroup.add(arm);

            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), lampMat);
            bulb.position.set(xPole + (xPole < 0 ? 1.2 : -1.2), 5.6, 0);
            rowGroup.add(bulb);
        });

        const palm = new THREE.Group();
        palm.position.set(8.2, 0.1, 3.5);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.28, 6.6, 10), trunkMat);
        trunk.position.y = 3.3;
        trunk.rotation.z = -0.09;
        trunk.castShadow = true;
        palm.add(trunk);

        for (let f = 0; f < 8; f++) {
            const frond = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.9, 5), leafMat);
            frond.position.set(0.55, 6.45, 0);
            frond.rotation.z = Math.PI / 2.25;
            frond.rotation.y = (f * Math.PI) / 4;
            frond.castShadow = true;
            palm.add(frond);
        }
        rowGroup.add(palm);

        if (i % 3 === 0) {
            const kiosk = new THREE.Group();
            kiosk.position.set(8.8, 0.1, -2.5);
            const base = new THREE.Mesh(
                new THREE.CylinderGeometry(1.5, 1.5, 1.1, 14),
                new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 })
            );
            base.position.y = 0.55;
            base.castShadow = true;
            kiosk.add(base);

            const roof = new THREE.Mesh(
                new THREE.ConeGeometry(2.1, 1.2, 14),
                new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 })
            );
            roof.position.y = 2.4;
            roof.castShadow = true;
            kiosk.add(roof);
            rowGroup.add(kiosk);
        }

        // Carrinho de água de coco na orla / calçadão
        if (i % 4 === 1) {
            const cocoCart = createCoconutCartMesh();
            cocoCart.position.set(10.3, 0.12, -1.5);
            cocoCart.rotation.y = -0.35;
            rowGroup.add(cocoCart);
        }

        // Varanda e aparelho de ar-condicionado na fachada do prédio
        const balcony = new THREE.Mesh(
            new THREE.BoxGeometry(0.75, 1.15, 2.6),
            new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.55 })
        );
        balcony.position.set(-10.1, 6.2, (i % 2 === 0 ? 1.8 : -1.8));
        balcony.castShadow = true;
        rowGroup.add(balcony);

        const acUnit = new THREE.Mesh(
            new THREE.BoxGeometry(0.45, 0.52, 0.85),
            new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.45 })
        );
        acUnit.position.set(-10.2, 8.6, (i % 2 === 0 ? -2.2 : 2.2));
        acUnit.castShadow = true;
        rowGroup.add(acUnit);

        // Toldo / marquise carioca na fachada do prédio
        const awning = new THREE.Mesh(
            new THREE.BoxGeometry(1.35, 0.24, bDepth - 1.2),
            new THREE.MeshStandardMaterial({ color: awnCol, roughness: 0.55 })
        );
        awning.position.set(-9.9, 3.1, 0);
        awning.rotation.z = -0.22;
        awning.castShadow = true;
        rowGroup.add(awning);

        // Guarda-sóis coloridos na areia da praia ao lado da ciclovia/calçadão
        if (i % 2 === 0) {
            const umbrellaColors = [0x0284c7, 0xfacc15, 0x16a34a, 0xea580c, 0xdc2626];
            const uCol = umbrellaColors[(i / 2) % umbrellaColors.length];
            const parasol = new THREE.Group();
            parasol.position.set(16.5 + (i % 4) * 3.2, -0.04, 1.5);

            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8),
                new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7, roughness: 0.3 })
            );
            pole.position.y = 1.1;
            parasol.add(pole);

            const canopy = new THREE.Mesh(
                new THREE.ConeGeometry(1.75, 0.68, 12),
                new THREE.MeshStandardMaterial({ color: uCol, roughness: 0.5, side: THREE.DoubleSide })
            );
            canopy.position.y = 2.05;
            canopy.castShadow = true;
            parasol.add(canopy);

            rowGroup.add(parasol);
        }

        scene.add(rowGroup);
        cityBuildings.push(rowGroup);
    }
}

function spawnPlayer(charType) {
    if (playerObj && playerObj.mesh) {
        scene.remove(playerObj.mesh);
    }
    playerObj = createCharacterMesh(charType);
    playerObj.mesh.position.set(0, 0, 0);
    scene.add(playerObj.mesh);
}

function startGame() {
    sfx.init();
    gameState = 'PLAYING';
    currentLane = 1;
    playerX = 0;
    playerY = 0;
    velocityY = 0;
    isJumping = false;
    isRolling = false;
    rollTimer = 0;
    strafeAnim = null;
    strafeTimer = 0;
    currentLocomotion = 'walk';
    hasSkate = false;
    skateTimer = 0;

    speed = baseSpeed;
    score = 0;
    coins = 0;
    distanceSinceLastSpawn = 0;

    obstacles.forEach(o => scene.remove(o.mesh));
    obstacles = [];
    collectibles.forEach(c => scene.remove(c.mesh));
    collectibles = [];

    spawnPlayer(selectedChar);
    chaserObj.group.position.set(0, 0, 3.2);

    document.getElementById('start-screen').classList.add('hidden');
    const _overEl = document.getElementById('gameover-screen'); _overEl.classList.add('hidden'); _overEl.style.display = '';
    document.getElementById('pause-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('powerup-indicator').classList.add('hidden');
    const saveOverBtn = document.getElementById('save-gameover-score-btn');
    if (saveOverBtn) {
        saveOverBtn.disabled = false;
        saveOverBtn.dataset.saved = 'false';
        saveOverBtn.textContent = 'SALVAR';
    }

    updateHUD();
}

function togglePause() {
    if (gameState === 'PLAYING') {
        gameState = 'PAUSED';
        document.getElementById('pause-screen').classList.remove('hidden');
    } else if (gameState === 'PAUSED') {
        gameState = 'PLAYING';
        clock.getDelta();
        document.getElementById('pause-screen').classList.add('hidden');
    }
}

function triggerGameOver() {
    if (gameState === 'GAMEOVER') return;
    gameState = 'GAMEOVER';
    isJumping = false;
    isRolling = false;
    hasSkate = false;

    try {
        setCharacterGoldenGlow(false);
    } catch (_) {}

    try {
        if (window.sfx && typeof sfx.crash === 'function') sfx.crash();
    } catch (_) {}

    const finalScoreInt = Math.max(0, Math.floor(score || 0));
    const finalCoinsInt = Math.max(0, Math.floor(coins || 0));
    if (finalScoreInt > bestScore) {
        bestScore = finalScoreInt;
        try {
            localStorage.setItem('rio_surfers_best', bestScore.toString());
        } catch (_) {}
    }

    const finalScoreEl = document.getElementById('final-score');
    const bestScoreEl = document.getElementById('best-score');
    const finalCoinsEl = document.getElementById('final-coins');
    if (finalScoreEl) finalScoreEl.textContent = finalScoreInt.toLocaleString('pt-BR');
    if (bestScoreEl) bestScoreEl.textContent = bestScore.toLocaleString('pt-BR');
    if (finalCoinsEl) finalCoinsEl.textContent = finalCoinsInt;

    const hudEl = document.getElementById('hud');
    const powerupEl = document.getElementById('powerup-indicator');
    const overScreenEl = document.getElementById('gameover-screen');
    if (hudEl) hudEl.classList.add('hidden');
    if (powerupEl) powerupEl.classList.add('hidden');
    if (overScreenEl) {
        overScreenEl.classList.remove('hidden');
        overScreenEl.style.display = 'flex';
    }

    window.lastRunScore = finalScoreInt;
    window.lastRunCoins = finalCoinsInt;
    window.selectedChar = selectedChar;

    try {
        const menuNameEl = document.getElementById('player-name-input');
        const overNameEl = document.getElementById('gameover-name-input');
        const currentTypedName = ((overNameEl && overNameEl.value) || (menuNameEl && menuNameEl.value) || (typeof getSavedPlayerName === 'function' ? getSavedPlayerName() : '')).trim();
        if (typeof syncAllPlayerNameInputs === 'function') {
            syncAllPlayerNameInputs(currentTypedName);
        }
        const saveOverBtnEl = document.getElementById('save-gameover-score-btn');
        if (saveOverBtnEl) {
            saveOverBtnEl.disabled = false;
            saveOverBtnEl.dataset.saving = 'false';
            saveOverBtnEl.dataset.saved = 'false';
            saveOverBtnEl.textContent = 'SALVAR';
        }
        if (typeof refreshRankingUI === 'function') {
            Promise.resolve(refreshRankingUI(currentTypedName)).catch(() => {});
        }
    } catch (err) {
        console.warn('Erro ao atualizar ranking no Game Over:', err);
    }
}

function triggerStrafeAnim(dir) {
    strafeAnim = dir;
    strafeTimer = 0.32;
    if (playerObj && playerObj.isGLB && playerObj.playAnim && !isJumping && !isRolling) {
        playerObj.playAnim(dir, 0.08);
    }
}

function moveLeft() {
    if (gameState !== 'PLAYING') return;
    if (currentLane > 0) {
        currentLane--;
        triggerStrafeAnim('left');
        sfx.dodge();
    }
}

function moveRight() {
    if (gameState !== 'PLAYING') return;
    if (currentLane < 2) {
        currentLane++;
        triggerStrafeAnim('right');
        sfx.dodge();
    }
}

function jump() {
    if (gameState !== 'PLAYING') return;
    if (!isJumping) {
        isJumping = true;
        isRolling = false;
        playerObj.mesh.scale.y = 1;
        velocityY = JUMP_FORCE;
        if (playerObj && playerObj.isGLB && playerObj.playAnim) {
            playerObj.playAnim('jump', 0.08);
        }
        sfx.jump();
    }
}

function roll() {
    if (gameState !== 'PLAYING') return;
    if (isJumping) {
        velocityY = -28;
    }
    isRolling = true;
    let duration = 0.65;
    if (playerObj && playerObj.isGLB && playerObj.playAnim) {
        playerObj.playAnim('roll', 0.08);
        const clipDur = playerObj.getClipDuration ? playerObj.getClipDuration('roll') : 0;
        if (clipDur > 0) {
            // Usa a duração real do clipe (entre 0.65s e 1.45s) e sincroniza o timeScale para completar 100% da animação
            duration = Math.min(Math.max(clipDur, 0.65), 1.45);
            if (playerObj.actions && playerObj.actions.roll) {
                playerObj.actions.roll.setEffectiveTimeScale(clipDur / duration);
            }
        }
    }
    rollTimer = duration;
    sfx.roll();
}


let originalCharMaterials = new Map();
let goldPowerupMat = null;
let goldSkinnedPowerupMat = null;

function setCharacterGoldenGlow(enabled, pulseTime = 0) {
    if (!playerObj || !playerObj.mesh) return;
    if (playerObj.board) {
        playerObj.board.visible = false;
    }

    if (enabled) {
        if (!goldPowerupMat) {
            goldPowerupMat = new THREE.MeshStandardMaterial({
                color: 0xfacc15,
                emissive: 0xf59e0b,
                emissiveIntensity: 0.9,
                metalness: 0.65,
                roughness: 0.22,
                transparent: false,
                opacity: 1,
                side: THREE.DoubleSide
            });
        }
        if (!goldSkinnedPowerupMat) {
            goldSkinnedPowerupMat = new THREE.MeshStandardMaterial({
                color: 0xfacc15,
                emissive: 0xf59e0b,
                emissiveIntensity: 0.9,
                metalness: 0.65,
                roughness: 0.22,
                skinning: true,
                transparent: false,
                opacity: 1,
                side: THREE.DoubleSide
            });
        }

        const blink = 0.5 + 0.5 * Math.sin(pulseTime * 18);
        const colHex = blink > 0.5 ? 0xfef08a : 0xf59e0b;
        const emHex = blink > 0.5 ? 0xfbbf24 : 0xd97706;
        const emInt = 0.35 + blink * 1.35;

        [goldPowerupMat, goldSkinnedPowerupMat].forEach(mat => {
            mat.color.setHex(colHex);
            mat.emissive.setHex(emHex);
            mat.emissiveIntensity = emInt;
            mat.opacity = 1;
            mat.transparent = false;
        });

        playerObj.mesh.visible = true;
        playerObj.mesh.traverse(child => {
            if (child.isMesh || child.isSkinnedMesh) {
                const isBoardPart = playerObj.board && (child === playerObj.board || playerObj.board.getObjectById(child.id));
                if (!isBoardPart) {
                    child.visible = true;
                    child.frustumCulled = false;
                    if (!originalCharMaterials.has(child.uuid)) {
                        originalCharMaterials.set(child.uuid, child.material);
                    }
                    child.material = child.isSkinnedMesh ? goldSkinnedPowerupMat : goldPowerupMat;
                }
            }
        });
    } else {
        playerObj.mesh.visible = true;
        playerObj.mesh.traverse(child => {
            if (child.isMesh || child.isSkinnedMesh) {
                const isBoardPart = playerObj.board && (child === playerObj.board || playerObj.board.getObjectById(child.id));
                if (!isBoardPart) {
                    child.visible = true;
                    if (originalCharMaterials.has(child.uuid)) {
                        child.material = originalCharMaterials.get(child.uuid);
                    }
                }
            }
        });
        originalCharMaterials.clear();
    }
}

function activateSkate() {
    if (gameState !== 'PLAYING' || hasSkate) return;
    hasSkate = true;
    skateTimer = SKATE_DURATION;
    if (playerObj.board) playerObj.board.visible = false;
    setCharacterGoldenGlow(true, 0);

    const indicator = document.getElementById('powerup-indicator');
    const powerupText = document.getElementById('powerup-text');
    if (powerupText) powerupText.textContent = 'Imunidade Parlamentar ativada';
    if (indicator) indicator.classList.remove('hidden');
    sfx.powerup();
}

// Cria um dos carros brasileiros clássicos (Uno Mille, Fusca, Kombi ou Táxi Amarelo)
function spawnBrazilianVehicle(laneIdx, zSpawn, spawnRoofCoins = false) {
    const rollCar = Math.random();
    let mesh, halfLength, height, forwardSpeed;

    if (rollCar < 0.30) {
        // Fiat Uno Mille (com ou sem escada!)
        mesh = createUnoMilleMesh();
        halfLength = 2.1;
        height = 1.72;
        forwardSpeed = 3.5; // Vem levemente na contramão
    } else if (rollCar < 0.58) {
        // Fusca Clássico
        mesh = createFuscaMesh();
        halfLength = 2.1;
        height = 1.65;
        forwardSpeed = 2.5;
    } else if (rollCar < 0.82) {
        // Kombi Saia e Blusa
        mesh = createKombiMesh();
        halfLength = 2.5;
        height = 2.22;
        forwardSpeed = 3.0;
    } else {
        // Táxi Amarelo do Rio
        mesh = createRioTaxiMesh();
        halfLength = 2.25;
        height = 1.62;
        forwardSpeed = 4.2;
    }

    mesh.position.set(LANES[laneIdx], 0, zSpawn);
    scene.add(mesh);

    obstacles.push({
        mesh,
        lane: laneIdx,
        type: 'vehicle',
        halfLength,
        halfWidth: 0.92,
        height,
        minY: 0,
        extraSpeedZ: forwardSpeed
    });

    if (spawnRoofCoins) {
        for (let i = -1; i <= 1; i++) {
            spawnCoin(LANES[laneIdx], height + 0.65, zSpawn + i * 1.4);
        }
    }
}

function spawnWave() {
    const zSpawn = -135;
    const lanesIdx = [0, 1, 2];
    lanesIdx.sort(() => Math.random() - 0.5);

    const laneA = lanesIdx[0];
    const typeA = Math.random();

    if (typeA < 0.52) {
        // Carro Brasileiro (Uno Mille, Fusca, Kombi ou Táxi)
        spawnBrazilianVehicle(laneA, zSpawn, true);
    } else if (typeA < 0.72) {
        // Cachorro Caramelo atravessando a rua de um lado para o outro!
        const dog = createCarameloDogMesh();
        const dir = Math.random() < 0.5 ? 1 : -1;
        const startX = dir === 1 ? -4.4 : 4.4;
        dog.position.set(startX, 0, zSpawn);
        dog.rotation.y = dir === 1 ? 0 : Math.PI;
        scene.add(dog);

        obstacles.push({
            mesh: dog,
            lane: laneA,
            type: 'caramelo',
            halfLength: 0.45,
            halfWidth: 0.58,
            height: 0.95,
            minY: 0,
            crossDir: dir,
            crossSpeed: 4.8 + Math.random() * 2.0,
            animPhase: Math.random() * 6,
            barked: false
        });
    } else if (typeA < 0.87) {
        // Cavalete baixo (pular por cima)
        const barrier = createBarrierMesh(false);
        barrier.position.set(LANES[laneA], 0, zSpawn);
        scene.add(barrier);
        obstacles.push({
            mesh: barrier,
            lane: laneA,
            type: 'low_barrier',
            halfLength: 0.4,
            halfWidth: 0.95,
            height: 1.15,
            minY: 0
        });

        spawnCoin(LANES[laneA], 1.8, zSpawn - 2);
        spawnCoin(LANES[laneA], 2.3, zSpawn);
        spawnCoin(LANES[laneA], 1.8, zSpawn + 2);
    } else {
        // Faixa alta (deslizar por baixo)
        const barrier = createBarrierMesh(true);
        barrier.position.set(LANES[laneA], 0, zSpawn);
        scene.add(barrier);
        obstacles.push({
            mesh: barrier,
            lane: laneA,
            type: 'high_barrier',
            halfLength: 0.4,
            halfWidth: 0.95,
            height: 2.7,
            minY: 1.45
        });

        spawnCoin(LANES[laneA], 0.6, zSpawn);
    }

    // Segundo obstáculo em outra faixa (frequência reduzida para deixar a pista mais fluida)
    if (Math.random() < 0.42) {
        const laneB = lanesIdx[1];
        if (Math.random() < 0.58) {
            spawnBrazilianVehicle(laneB, zSpawn - 3.5, false);
        } else {
            const barrier = createBarrierMesh(false);
            barrier.position.set(LANES[laneB], 0, zSpawn);
            scene.add(barrier);
            obstacles.push({
                mesh: barrier,
                lane: laneB,
                type: 'low_barrier',
                halfLength: 0.4,
                halfWidth: 0.95,
                height: 1.15,
                minY: 0
            });
        }
    }


    // Novos obstáculos brasileiros: Buraco com placa, Moto apressada e Carro da Polícia
    if (typeA >= 0.87 && Math.random() < 0.42) {
        const subRoll = Math.random();
        if (subRoll < 0.36) {
            const holeMesh = createRoadHoleMesh();
            holeMesh.position.set(LANES[laneA], 0, zSpawn);
            scene.add(holeMesh);
            obstacles.push({
                mesh: holeMesh,
                lane: laneA,
                type: 'road_hole',
                halfLength: 1.05,
                halfWidth: 0.95,
                height: 0.45,
                minY: 0
            });
        } else if (subRoll < 0.70) {
            const motoMesh = createDeliveryMotoMesh();
            motoMesh.position.set(LANES[laneA], 0, zSpawn);
            scene.add(motoMesh);
            obstacles.push({
                mesh: motoMesh,
                lane: laneA,
                type: 'moto',
                baseX: LANES[laneA],
                weavePhase: Math.random() * Math.PI * 2,
                weaveAmp: 1.15,
                weaveFreq: 4.2,
                halfLength: 0.85,
                halfWidth: 0.48,
                height: 1.72,
                minY: 0,
                extraSpeedZ: 7.5
            });
        } else {
            const policeMesh = createPoliceCarMesh();
            policeMesh.position.set(LANES[laneA], 0, zSpawn);
            scene.add(policeMesh);
            obstacles.push({
                mesh: policeMesh,
                lane: laneA,
                type: 'police_car',
                halfLength: 2.05,
                halfWidth: 0.94,
                height: 1.75,
                minY: 0,
                extraSpeedZ: 3.2
            });
        }
    }

    // Moedas ou Power-up na terceira faixa
    const laneC = lanesIdx[2];
    if (Math.random() < 0.14 && !hasSkate) {
        const skatePickup = createSkatePickupMesh();
        skatePickup.position.set(LANES[laneC], 0.9, zSpawn);
        scene.add(skatePickup);
        collectibles.push({
            mesh: skatePickup,
            type: 'skate'
        });
    } else {
        for (let i = 0; i < 5; i++) {
            spawnCoin(LANES[laneC], 0.75, zSpawn - i * 2.3);
        }
    }
}

function spawnCoin(x, y, z) {
    const coin = createCoinMesh();
    coin.position.set(x, y, z);
    scene.add(coin);
    collectibles.push({
        mesh: coin,
        type: 'coin'
    });
}

function update(dt) {
    if (rioProps) {
        const nowSec = performance.now() * 0.001;
        if (rioProps.cableCar) {
            const t = (Math.sin(nowSec * 0.3) + 1) * 0.5;
            rioProps.cableCar.position.set(26 + t * 30, 28 + t * 23, -152 - t * 10);
        }
        if (rioProps.waveStripes) {
            rioProps.waveStripes.forEach(w => {
                const sway = Math.sin(nowSec * 1.8 + w.phase) * 1.4;
                w.mesh.position.x = w.baseX + sway;
                w.mesh.position.z = -80 + ((nowSec * speed * 0.35 + w.phase * 12) % 24);
            });
        }
    }

    if (gameState !== 'PLAYING') {
        if (gameState === 'MENU' && playerObj) {
            runAnimTime += dt * 2.2;
            playerObj.mesh.position.set(0, 1.5, 4.9);
            playerObj.mesh.rotation.y = playerObj.isGLB ? Math.sin(runAnimTime * 0.7) * 0.55 : Math.sin(runAnimTime * 0.7) * 0.65;
            if (playerObj.isGLB && playerObj.playAnim) {
                const menuState = (playerObj.actions && playerObj.actions.walk) ? 'walk' : 'run';
                playerObj.playAnim(menuState, 0.12);
            }
            if (playerObj.mixer) playerObj.mixer.update(dt * 0.5);
        }
        return;
    }

    playerObj.mesh.position.z = 0;
    playerObj.mesh.rotation.y = playerObj.isGLB ? 0 : Math.PI;

    const accelRate = speed < RUN_SPEED_THRESHOLD ? 0.68 : 0.36;
    speed = Math.min(maxSpeed, speed + dt * accelRate);
    currentLocomotion = speed >= RUN_SPEED_THRESHOLD ? 'run' : 'walk';
    const moveDist = speed * dt;
    score += moveDist * 1.5;

    if (strafeTimer > 0) {
        strafeTimer -= dt;
        if (strafeTimer <= 0) {
            strafeAnim = null;
        }
    }

    roadSegments.forEach(seg => {
        seg.position.z += moveDist;
        if (seg.position.z > 25) {
            seg.position.z -= 14 * 15;
        }
    });

    cityBuildings.forEach(b => {
        b.position.z += moveDist;
        if (b.position.z > 25) {
            b.position.z -= 16 * 12;
        }
    });

    distanceSinceLastSpawn += moveDist;
    const spawnInterval = Math.max(26, 38 - (speed - baseSpeed) * 0.25);
    if (distanceSinceLastSpawn >= spawnInterval) {
        distanceSinceLastSpawn = 0;
        spawnWave();
    }

    const targetX = LANES[currentLane];
    playerX += (targetX - playerX) * Math.min(1, dt * 14);
    playerObj.mesh.position.x = playerX;

    // Permite subir/pular por cima do capô e teto dos carros brasileiros (Uno, Fusca, Kombi, Táxi)
    let groundHeight = 0;
    for (const obs of obstacles) {
        if (obs.type === 'vehicle') {
            const dx = Math.abs(playerX - obs.mesh.position.x);
            const dz = Math.abs(obs.mesh.position.z);
            if (dx < obs.halfWidth + 0.15 && dz < obs.halfLength && playerY >= obs.height - 0.42) {
                groundHeight = Math.max(groundHeight, obs.height);
            }
        }
    }

    const wasJumping = isJumping;
    if (playerY > groundHeight || velocityY > 0) {
        velocityY += GRAVITY * dt;
        playerY += velocityY * dt;
        if (playerY <= groundHeight) {
            playerY = groundHeight;
            velocityY = 0;
            isJumping = false;
        }
    } else {
        playerY = groundHeight;
        isJumping = false;
    }
    playerObj.mesh.position.y = playerY;

    if (wasJumping && !isJumping && !isRolling && playerObj.isGLB && playerObj.playAnim) {
        playerObj.playAnim('run', 0.12);
    }

    const desiredBaseAnim = currentLocomotion; // 'walk' ou 'run'

    if (isRolling) {
        rollTimer -= dt;
        if (!playerObj.isGLB || !playerObj.actions || !playerObj.actions.roll) {
            playerObj.mesh.scale.y = 0.52;
        } else {
            playerObj.mesh.scale.y = 1;
        }
        if (rollTimer <= 0) {
            isRolling = false;
            playerObj.mesh.scale.y = 1;
            if (!isJumping && playerObj.isGLB && playerObj.playAnim) {
                playerObj.playAnim(strafeAnim || desiredBaseAnim, 0.12);
            }
        }
    } else {
        playerObj.mesh.scale.y = 1;
        if (!isJumping && playerObj.isGLB && playerObj.playAnim) {
            const targetState = strafeAnim || desiredBaseAnim;
            playerObj.playAnim(targetState, 0.14);
        }
    }

    if (playerObj && playerObj.glbModel) {
        const hasDedicatedStrafeClip = !!(strafeAnim && playerObj.actions && playerObj.actions[strafeAnim]);
        const targetLeanZ = (strafeAnim && !hasDedicatedStrafeClip)
            ? (strafeAnim === 'left' ? 0.24 : -0.24)
            : 0;
        playerObj.glbModel.rotation.z += (targetLeanZ - playerObj.glbModel.rotation.z) * Math.min(1, dt * 14);
    }

    if (hasSkate) {
        skateTimer -= dt;
        setCharacterGoldenGlow(true, performance.now() * 0.004);
        const pct = Math.max(0, (skateTimer / SKATE_DURATION) * 100);
        document.getElementById('powerup-bar').style.width = pct + '%';
        if (skateTimer <= 0) {
            hasSkate = false;
            if (playerObj.board) playerObj.board.visible = false;
    setCharacterGoldenGlow(false);
            document.getElementById('powerup-indicator').classList.add('hidden');
        }
    }

    const cadenceFactor = currentLocomotion === 'run' ? (speed * 0.72) : (speed * 0.45);
    runAnimTime += dt * cadenceFactor;

    if (playerObj.isGLB) {
        if (playerObj.mixer) {
            // Durante Jump ou Roll usa 1.0 para respeitar o tempo exato do clipe e não cortar na metade
            const animSpeedFactor = (isJumping || isRolling) ? 1.0 : Math.max(0.75, speed / baseSpeed);
            playerObj.mixer.update(dt * animSpeedFactor);
        } else {
            const bounceAmp = currentLocomotion === 'run' ? 0.15 : 0.07;
            playerObj.glbModel.position.y = Math.abs(Math.sin(runAnimTime)) * bounceAmp;
            playerObj.glbModel.rotation.z = Math.sin(runAnimTime) * 0.06;
        }
    } else if (hasSkate) {
        playerObj.leftLeg.rotation.x = 0.15;
        playerObj.rightLeg.rotation.x = -0.15;
        playerObj.leftArm.rotation.x = -0.4;
        playerObj.rightArm.rotation.x = 0.4;
        playerObj.torso.position.y = 1.22 + Math.sin(runAnimTime) * 0.04;
    } else if (isJumping) {
        playerObj.leftLeg.rotation.x = 0.65;
        playerObj.rightLeg.rotation.x = -0.45;
        playerObj.leftArm.rotation.x = -2.2;
        playerObj.rightArm.rotation.x = -2.2;
        playerObj.torso.rotation.z = 0;
    } else {
        const strideAmp = currentLocomotion === 'run' ? 0.92 : 0.48;
        const armAmp = currentLocomotion === 'run' ? 0.82 : 0.38;
        const bobAmp = currentLocomotion === 'run' ? 0.09 : 0.04;
        playerObj.leftLeg.rotation.x = Math.sin(runAnimTime) * strideAmp;
        playerObj.rightLeg.rotation.x = -Math.sin(runAnimTime) * strideAmp;
        playerObj.leftArm.rotation.x = -Math.sin(runAnimTime) * armAmp;
        playerObj.rightArm.rotation.x = Math.sin(runAnimTime) * armAmp;
        playerObj.torso.position.y = 1.15 + Math.abs(Math.cos(runAnimTime)) * bobAmp;

        // Inclinação lateral suave para Left e Right
        const targetLeanZ = strafeAnim === 'left' ? 0.24 : (strafeAnim === 'right' ? -0.24 : 0);
        playerObj.torso.rotation.z += (targetLeanZ - playerObj.torso.rotation.z) * Math.min(1, dt * 14);
    }

    if (chaserObj.group.position.z < 9.5) {
        chaserObj.group.position.z += dt * 1.4;
    }
    chaserObj.group.position.x += (playerX - chaserObj.group.position.x) * dt * 4;
    chaserObj.group.position.y = Math.abs(Math.sin(runAnimTime * 1.2)) * 0.15;

    const playerHeight = isRolling ? 0.95 : 2.1;
    const playerTop = playerY + playerHeight;
    const playerBottom = playerY;

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        const extraMove = (obs.extraSpeedZ || 0) * dt;
        obs.mesh.position.z += moveDist + extraMove;

        // Animação do Cachorro Caramelo atravessando a avenida
        if (obs.type === 'caramelo') {
            obs.mesh.position.x += obs.crossDir * obs.crossSpeed * dt;
            if (obs.mesh.position.x > 4.4) {
                obs.mesh.position.x = 4.4;
                obs.crossDir = -1;
                obs.mesh.rotation.y = Math.PI;
            } else if (obs.mesh.position.x < -4.4) {
                obs.mesh.position.x = -4.4;
                obs.crossDir = 1;
                obs.mesh.rotation.y = 0;
            }

            // Latido quando o jogador chega perto
            if (!obs.barked && obs.mesh.position.z > -26 && obs.mesh.position.z < -18) {
                obs.barked = true;
                sfx.bark();
            }

            // Animação das patinhas e rabinho
            obs.animPhase += dt * 18;
            const { legs, tail } = obs.mesh.userData;
            if (legs) {
                legs[0].rotation.z = Math.sin(obs.animPhase) * 0.7;
                legs[1].rotation.z = -Math.sin(obs.animPhase) * 0.7;
                legs[2].rotation.z = -Math.sin(obs.animPhase) * 0.7;
                legs[3].rotation.z = Math.sin(obs.animPhase) * 0.7;
            }
            if (tail) {
                tail.rotation.x = Math.sin(obs.animPhase * 1.4) * 0.45;
            }
            obs.mesh.position.y = Math.abs(Math.sin(obs.animPhase)) * 0.08;

            obs.dashTimer = (obs.dashTimer || 0) - dt;
            if (obs.dashTimer <= 0) {
                obs.dashTimer = 0.65 + Math.random() * 0.85;
                obs.dashMult = Math.random() < 0.35 ? 0.45 : (1.15 + Math.random() * 0.45);
            }
            const stepSpeed = obs.crossSpeed * (obs.dashMult || 1);
            obs.mesh.position.x += obs.crossDir * stepSpeed * dt;
            if (obs.mesh.position.x > 4.4) {
                obs.mesh.position.x = 4.4;
                obs.crossDir = -1;
                obs.mesh.rotation.y = Math.PI;
            } else if (obs.mesh.position.x < -4.4) {
                obs.mesh.position.x = -4.4;
                obs.crossDir = 1;
                obs.mesh.rotation.y = 0;
            }
            obs.mesh.rotation.z = -obs.crossDir * Math.sin(obs.animPhase) * 0.08;
        }

        if (obs.type === 'moto') {
            obs.weavePhase = (obs.weavePhase || 0) + dt * (obs.weaveFreq || 4.2);
            const targetWeaveX = obs.baseX + Math.sin(obs.weavePhase) * (obs.weaveAmp || 1.15);
            const prevX = obs.mesh.position.x;
            obs.mesh.position.x = Math.max(-3.6, Math.min(3.6, targetWeaveX));
            const vx = (obs.mesh.position.x - prevX) / Math.max(dt, 0.001);
            obs.mesh.rotation.z = Math.max(-0.32, Math.min(0.32, -vx * 0.06));
        }

        if (obs.type === 'police_car' && obs.mesh.userData) {
            const flashOn = Math.floor(performance.now() / 110) % 2 === 0;
            const { redLamp, blueLamp } = obs.mesh.userData;
            if (redLamp) redLamp.scale.setScalar(flashOn ? 1.25 : 0.85);
            if (blueLamp) blueLamp.scale.setScalar(flashOn ? 0.85 : 1.25);
        }

        const obsCenterX = obs.mesh.position.x;
        const dx = Math.abs(playerX - obsCenterX);
        const dz = Math.abs(obs.mesh.position.z);

        if (dx < obs.halfWidth && dz < obs.halfLength + 0.32) {
            const hitVertical = playerBottom < obs.height - 0.15 && playerTop > obs.minY + 0.1;
            if (hitVertical) {
                if (hasSkate) {
                    hasSkate = false;
                    if (playerObj.board) playerObj.board.visible = false;
    setCharacterGoldenGlow(false);
                    document.getElementById('powerup-indicator').classList.add('hidden');
                    sfx.crash();
                    scene.remove(obs.mesh);
                    obstacles.splice(i, 1);
                    continue;
                } else {
                    chaserObj.group.position.z = 1.2;
                    triggerGameOver();
                    return;
                }
            }
        }

        if (obs.mesh.position.z > 20) {
            scene.remove(obs.mesh);
            obstacles.splice(i, 1);
        }
    }

    for (let i = collectibles.length - 1; i >= 0; i--) {
        const item = collectibles[i];
        item.mesh.position.z += moveDist;
        if (item.type === 'coin') {
            item.mesh.rotation.y += dt * 2.8;
            item.mesh.rotation.z = Math.sin(performance.now() * 0.006 + i) * 0.14;
        } else {
            item.mesh.rotation.y += dt * 3.5;
        }

        const dx = Math.abs(playerX - item.mesh.position.x);
        const dy = Math.abs((playerY + 1.0) - item.mesh.position.y);
        const dz = Math.abs(item.mesh.position.z);

        if (dx < 1.0 && dy < 1.35 && dz < 1.0) {
            if (item.type === 'coin') {
                coins++;
                score += 25;
                sfx.coin();
            } else if (item.type === 'skate') {
                activateSkate();
            }
            scene.remove(item.mesh);
            collectibles.splice(i, 1);
            continue;
        }

        if (item.mesh.position.z > 15) {
            scene.remove(item.mesh);
            collectibles.splice(i, 1);
        }
    }

    updateHUD();
}

function updateHUD() {
    document.getElementById('score-val').textContent = Math.floor(score).toString().padStart(6, '0');
    document.getElementById('coins-val').textContent = coins;
}

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt);
    renderer.render(scene, camera);
}

function setupEvents() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.querySelectorAll('.char-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedChar = card.dataset.char;
            window.selectedChar = selectedChar;
            spawnPlayer(selectedChar);
        });
    });

    document.getElementById('play-btn').addEventListener('click', startGame);
    document.getElementById('play-again-btn').addEventListener('click', startGame);
    document.getElementById('restart-pause-btn').addEventListener('click', startGame);
    document.getElementById('pause-btn').addEventListener('click', togglePause);
    document.getElementById('resume-btn').addEventListener('click', togglePause);

    document.getElementById('change-char-btn').addEventListener('click', () => {
        gameState = 'MENU';
        const _overEl = document.getElementById('gameover-screen'); _overEl.classList.add('hidden'); _overEl.style.display = '';
        document.getElementById('start-screen').classList.remove('hidden');
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') moveLeft();
        else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') moveRight();
        else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') jump();
        else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') roll();
        else if (e.key === ' ') {
            e.preventDefault();
            activateSkate();
        } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
            if (gameState === 'PLAYING' || gameState === 'PAUSED') togglePause();
        }
    });

    let touchStartX = 0;
    let touchStartY = 0;
    let lastTap = 0;

    window.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;

            const now = Date.now();
            if (now - lastTap < 280) {
                activateSkate();
            }
            lastTap = now;
        }
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
        if (e.changedTouches.length > 0) {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;

            if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
                if (Math.abs(dx) > Math.abs(dy)) {
                    if (dx > 0) moveRight();
                    else moveLeft();
                } else {
                    if (dy < 0) jump();
                    else roll();
                }
            }
        }
    }, { passive: true });

    const donateModal = document.getElementById('donate-modal');
    const donateBtn = document.getElementById('donate-btn');
    const closeDonateBtn = document.getElementById('close-donate-btn');
    const copyPixBtn = document.getElementById('copy-pix-btn');
    const pixKeyInput = document.getElementById('pix-key-input');
    const copyPixFeedback = document.getElementById('copy-pix-feedback');

    if (donateBtn && donateModal) {
        donateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (copyPixFeedback) copyPixFeedback.textContent = '';
            donateModal.classList.remove('hidden');
        });
    }
    if (closeDonateBtn && donateModal) {
        closeDonateBtn.addEventListener('click', () => donateModal.classList.add('hidden'));
    }
    if (donateModal) {
        donateModal.addEventListener('click', (e) => {
            if (e.target === donateModal) donateModal.classList.add('hidden');
        });
    }
    if (copyPixBtn && pixKeyInput) {
        copyPixBtn.addEventListener('click', async () => {
            const keyVal = pixKeyInput.value;
            try {
                await navigator.clipboard.writeText(keyVal);
            } catch (_) {
                pixKeyInput.select();
                document.execCommand('copy');
            }
            if (copyPixFeedback) copyPixFeedback.textContent = 'Chave Pix copiada!';
        });
    }
}



    const shareGameBtn = document.getElementById('share-game-btn');
    const shareGameFeedback = document.getElementById('share-game-feedback');
    if (shareGameBtn) {
        shareGameBtn.addEventListener('click', async () => {
            const shareUrl = window.location.href;
            const curScoreEl = document.getElementById('final-score');
            const ptsText = curScoreEl ? curScoreEl.textContent.trim() : '';
            const shareText = ptsText
                ? `Fiz ${ptsText} pontos na Corrida do BolsoPetismo 3D! Tenta bater meu recorde:`
                : 'Vem jogar Corrida do BolsoPetismo 3D comigo!';

            if (navigator.share) {
                try {
                    await navigator.share({
                        title: 'Corrida do BolsoPetismo — Edição Brasil 3D',
                        text: shareText,
                        url: shareUrl
                    });
                    if (shareGameFeedback) shareGameFeedback.textContent = 'Link compartilhado!';
                    return;
                } catch (err) {
                    if (err && err.name === 'AbortError') return;
                }
            }

            try {
                await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
            } catch (_) {
                const tempInput = document.createElement('input');
                tempInput.value = `${shareText} ${shareUrl}`;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);
            }
            if (shareGameFeedback) {
                shareGameFeedback.textContent = 'Link copiado para compartilhar com os amigos!';
            }
        });
    }

    window.addEventListener('DOMContentLoaded', init);
