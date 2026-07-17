import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as CANNON from "cannon-es";
type FortressState = "idle" | "charging" | "charged" | "flash" | "explosion" | "aftermath";
type BasicSphereMesh = THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
type RingMesh = THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
type FireballMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
type FireballLayer = {
    mesh: FireballMesh;
    maxScale: number;
    maxOpacity: number;
    delay: number;
    pulseSpeed: number;
    pulseOffset: number;
    pulseAmount: number;
    stretch: THREE.Vector3;
    rotationSpeed: THREE.Vector3;
};
type ShockwaveLayer = {
    mesh: RingMesh;
    maxScale: number;
    maxOpacity: number;
    delay: number;
    easePower: number;
    rotationSpeed: number;
    stretch: THREE.Vector2;
    fadeStart: number;
};
type DebrisItem = {
    mesh: THREE.Mesh;
    body: CANNON.Body;
};
type SmokeParticle = {
    sprite: THREE.Sprite;
    velocity: THREE.Vector3;
    rotationSpeed: number;
    delay: number;
    life: number;
    startScale: number;
    endScale: number;
    baseOpacity: number;
};
const CONFIG = {
    fortressRadius: 2,
    fortressRotationSpeed: 0.12,
    warningDuration: 2.4,
    chargedDuration: 0.3,
    flashDuration: 0.45,
    explosionDuration: 2.4,
    shockwaveDuration: 1.0,
    sparkCount: 700,
    sparkDuration: 3.2,
    debrisCount: 36,
    debrisDuration: 7,
    smokeCount: 48,
    fixedTimeStep: 1 / 60,
} as const;
const COLORS = {
    background: 0x000008,
    fortress: 0x626873,
    fortressEmissive: 0x550800,
    warning: 0xff5a18,
    smokeHot: new THREE.Color(0xffa078),
    smokeMiddle: new THREE.Color(0xb84f3d),
    smokeCold: new THREE.Color(0x39282e),
} as const;
const clamp01 = (value: number): number => THREE.MathUtils.clamp(value, 0, 1);
const easeOut = (progress: number, power = 3): number => 1 - Math.pow(1 - progress, power);
class ThreeJSContainer {
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private orbitControls!: OrbitControls;
    private readonly clock = new THREE.Clock();
    private readonly physicsWorld = new CANNON.World({
        gravity: new CANNON.Vec3(0, 0, 0),
    });
    private fortressState: FortressState = "idle";
    private warningElapsed = 0;
    private flashElapsed = 0;
    private explosionElapsed = 0;
    private shockwaveElapsed = 0;
    private sparkElapsed = 0;
    private debrisElapsed = 0;
    private smokeElapsed = 0;
    private sparkActive = false;
    private debrisActive = false;
    private smokeActive = false;
    private readonly fortressGroup = new THREE.Group();
    private bodyMaterial!: THREE.MeshStandardMaterial;
    private warningGlow!: BasicSphereMesh;
    private warningLight!: THREE.PointLight;
    private flashMesh!: BasicSphereMesh;
    private flashLight!: THREE.PointLight;
    private readonly explosionGroup = new THREE.Group();
    private fireballs: FireballLayer[] = [];
    private explosionLight!: THREE.PointLight;
    private readonly shockwaveGroup = new THREE.Group();
    private shockwaves: ShockwaveLayer[] = [];
    private sparkTrails!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    private sparkVelocities!: Float32Array;
    private sparkAges!: Float32Array;
    private sparkLives!: Float32Array;
    private debrisItems: DebrisItem[] = [];
    private debrisMaterial!: THREE.MeshStandardMaterial;
    private readonly smokeGroup = new THREE.Group();
    private smokeParticles: SmokeParticle[] = [];
    public createRendererDOM = (width: number, height: number, cameraPosition: THREE.Vector3): HTMLCanvasElement => {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(COLORS.background);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        this.camera.position.copy(cameraPosition);
        this.camera.lookAt(0, 0, 0);
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.minDistance = 4;
        this.orbitControls.maxDistance = 20;
        this.createScene();
        this.setupInput();
        this.startAnimation();
        window.addEventListener("resize", this.onWindowResize);
        return this.renderer.domElement;
    };
    private createScene = (): void => {
        this.scene = new THREE.Scene();
        this.createLights();
        this.createStarField();
        this.createFortress();
        this.createExplosionEffect();
        this.createShockwaveEffect();
        this.createSparkEffect();
        this.createDebrisEffect();
        this.createSmokeEffect();
    };
    private createLights = (): void => {
        const ambient = new THREE.AmbientLight(0x526080, 0.7);
        const main = new THREE.DirectionalLight(0xffffff, 2.2);
        main.position.set(5, 6, 8);
        main.castShadow = true;
        const fill = new THREE.DirectionalLight(0x4169a1, 0.7);
        fill.position.set(-5, -2, -4);
        this.scene.add(ambient, main, fill);
    };
    private createStarField = (): void => {
        const starCount = 2500;
        const positions = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
            const radius = THREE.MathUtils.randFloat(30, 100);
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
            const index = i * 3;
            positions[index] = radius * Math.sin(phi) * Math.cos(theta);
            positions[index + 1] = radius * Math.cos(phi);
            positions[index + 2] = radius * Math.sin(phi) * Math.sin(theta);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.12,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.9,
        });
        this.scene.add(new THREE.Points(geometry, material));
    };
    private createFortress = (): void => {
        this.fortressGroup.clear();
        this.bodyMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.fortress,
            roughness: 0.82,
            metalness: 0.45,
            emissive: COLORS.fortressEmissive,
            emissiveIntensity: 0,
        });
        const body = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.fortressRadius, 64, 64), this.bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        this.fortressGroup.add(body);
        const equator = new THREE.Mesh(
            new THREE.TorusGeometry(2.015, 0.055, 12, 128),
            new THREE.MeshStandardMaterial({
                color: 0x20242c,
                roughness: 0.7,
                metalness: 0.6,
            }),
        );
        equator.rotation.x = Math.PI / 2;
        this.fortressGroup.add(equator);
        this.createMainDish();
        this.createSurfacePanels();
        this.createWarningEffect();
        this.createFlashEffect();
        this.fortressGroup.rotation.z = THREE.MathUtils.degToRad(-8);
        this.scene.add(this.fortressGroup);
    };
    private createMainDish = (): void => {
        const dishGroup = new THREE.Group();
        dishGroup.add(
            new THREE.Mesh(
                new THREE.CircleGeometry(0.48, 48),
                new THREE.MeshStandardMaterial({
                    color: 0x181b21,
                    roughness: 0.9,
                    metalness: 0.2,
                    side: THREE.DoubleSide,
                }),
            ),
            new THREE.Mesh(
                new THREE.TorusGeometry(0.5, 0.035, 12, 48),
                new THREE.MeshStandardMaterial({
                    color: 0x9299a3,
                    roughness: 0.6,
                    metalness: 0.5,
                }),
            ),
        );
        const direction = new THREE.Vector3(0.48, 0.35, 0.8).normalize();
        dishGroup.position.copy(direction).multiplyScalar(2.015);
        dishGroup.lookAt(dishGroup.position.clone().multiplyScalar(2));
        this.fortressGroup.add(dishGroup);
    };
    private createSurfacePanels = (): void => {
        const geometry = new THREE.BoxGeometry(0.12, 0.08, 0.025);
        const material = new THREE.MeshStandardMaterial({
            color: 0x343943,
            roughness: 0.75,
            metalness: 0.35,
        });
        for (let i = 0; i < 130; i++) {
            const panel = new THREE.Mesh(geometry, material);
            const theta = Math.random() * Math.PI * 2;
            const phi = THREE.MathUtils.randFloat(0.25, Math.PI - 0.25);
            const radius = 2.025;
            panel.position.set(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
            panel.lookAt(0, 0, 0);
            panel.scale.set(THREE.MathUtils.randFloat(0.7, 1.6), THREE.MathUtils.randFloat(0.6, 1.4), 1);
            panel.castShadow = true;
            this.fortressGroup.add(panel);
        }
    };
    private createWarningEffect = (): void => {
        this.warningGlow = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 32, 32),
            new THREE.MeshBasicMaterial({
                color: COLORS.warning,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        const direction = new THREE.Vector3(0.48, 0.35, 0.8).normalize();
        this.warningGlow.position.copy(direction).multiplyScalar(2.12);
        this.warningGlow.scale.setScalar(0.1);
        this.warningLight = new THREE.PointLight(0xff4818, 0, 8, 2);
        this.warningLight.position.copy(this.warningGlow.position);
        this.fortressGroup.add(this.warningGlow, this.warningLight);
    };
    private createFlashEffect = (): void => {
        this.flashMesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 48, 48),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthTest: false,
                depthWrite: false,
            }),
        );
        this.flashMesh.scale.setScalar(0.05);
        this.flashMesh.visible = false;
        this.flashMesh.renderOrder = 19;
        this.flashLight = new THREE.PointLight(0xffffff, 0, 30, 2);
        this.fortressGroup.add(this.flashMesh, this.flashLight);
    };
    private startWarning = (): void => {
        if (this.fortressState !== "idle") return;
        this.fortressState = "charging";
        this.warningElapsed = 0;
    };
    private updateWarning = (deltaTime: number): void => {
        if (this.fortressState !== "charging" && this.fortressState !== "charged") {
            return;
        }
        this.warningElapsed += deltaTime;
        if (this.fortressState === "charging") {
            const progress = clamp01(this.warningElapsed / CONFIG.warningDuration);
            const smooth = progress * progress * (3 - 2 * progress);
            const pulse = 0.5 + 0.5 * Math.sin(this.warningElapsed * 12);
            this.warningGlow.material.opacity = 0.1 + smooth * (0.55 + pulse * 0.35);
            this.warningGlow.scale.setScalar(0.2 + smooth * 1.5 + pulse * 0.08);
            this.warningLight.intensity = smooth * (3.5 + pulse * 3);
            this.bodyMaterial.emissiveIntensity = smooth * (0.35 + pulse * 0.35);
            if (progress >= 1) {
                this.fortressState = "charged";
                this.warningElapsed = 0;
            }
            return;
        }
        const pulse = 0.5 + 0.5 * Math.sin(this.warningElapsed * 20);
        this.warningGlow.material.opacity = 0.75 + pulse * 0.2;
        this.warningGlow.scale.setScalar(1.7 + pulse * 0.15);
        this.warningLight.intensity = 6 + pulse * 3;
        this.bodyMaterial.emissiveIntensity = 0.75 + pulse * 0.25;
        if (this.warningElapsed >= CONFIG.chargedDuration) {
            this.startFlash();
        }
    };
    private startFlash = (): void => {
        this.fortressState = "flash";
        this.flashElapsed = 0;
        this.flashMesh.visible = true;
        this.flashMesh.material.opacity = 0;
        this.flashMesh.scale.setScalar(0.05);
        this.flashLight.intensity = 0;
        this.warningGlow.material.opacity = 0;
        this.warningLight.intensity = 0;
        this.bodyMaterial.emissive.setHex(0xffffff);
        this.bodyMaterial.emissiveIntensity = 2;
    };
    private updateFlash = (deltaTime: number): void => {
        if (this.fortressState !== "flash") return;
        this.flashElapsed += deltaTime;
        const progress = clamp01(this.flashElapsed / CONFIG.flashDuration);
        const opacity = progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) / 0.8;
        const visibleOpacity = clamp01(opacity);
        this.flashMesh.scale.setScalar(0.05 + easeOut(progress) * 5.5);
        this.flashMesh.material.opacity = visibleOpacity;
        this.flashLight.intensity = visibleOpacity * 25;
        this.bodyMaterial.emissiveIntensity = visibleOpacity * 2;
        if (progress >= 1) {
            this.flashMesh.visible = false;
            this.flashMesh.material.opacity = 0;
            this.flashLight.intensity = 0;
            this.bodyMaterial.emissive.setHex(COLORS.fortressEmissive);
            this.bodyMaterial.emissiveIntensity = 0;
            this.startExplosion();
        }
    };
    private createIrregularFireballGeometry = (roughness: number, frequency: number, seed: number): THREE.BufferGeometry => {
        const geometry = new THREE.IcosahedronGeometry(1, 4);
        const position = geometry.getAttribute("position") as THREE.BufferAttribute;
        const vertex = new THREE.Vector3();
        for (let i = 0; i < position.count; i++) {
            vertex.set(position.getX(i), position.getY(i), position.getZ(i));
            vertex.normalize();
            const waveA =
                Math.sin(vertex.x * frequency + seed) *
                Math.sin(vertex.y * frequency * 1.17 + seed * 1.31) *
                Math.sin(vertex.z * frequency * 0.83 + seed * 0.73);
            const waveB = Math.sin((vertex.x + vertex.y + vertex.z) * frequency * 1.9 + seed * 2.3);
            const radius = 1 + waveA * roughness + waveB * roughness * 0.35;
            vertex.multiplyScalar(radius);
            position.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }
        position.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        return geometry;
    };
    private createExplosionEffect = (): void => {
        this.fireballs = [
            this.createFireballLayer(
                this.createIrregularFireballGeometry(0.06, 8, 0.5),
                0xfff5e0,
                20,
                1.15,
                0.4,
                0,
                18,
                0,
                0.025,
                new THREE.Vector3(0.62, 1.08, 0.75),
                new THREE.Vector3(0.12, 0.08, 0.05),
            ),
            this.createFireballLayer(
                this.createIrregularFireballGeometry(0.1, 6.5, 2.4),
                0xffde75,
                19,
                2.55,
                0.46,
                0.02,
                14,
                1,
                0.035,
                new THREE.Vector3(0.88, 1.35, 0.9),
                new THREE.Vector3(0.28, 0.35, 0.14),
            ),
            this.createFireballLayer(
                this.createIrregularFireballGeometry(0.18, 5, 4.8),
                0xff7a38,
                18,
                3.35,
                0.24,
                0.05,
                11,
                2,
                0.05,
                new THREE.Vector3(0.95, 1.48, 0.92),
                new THREE.Vector3(-0.18, 0.1, 0.22),
            ),
        ];
        this.explosionLight = new THREE.PointLight(0xffb070, 0, 38, 2);
        this.explosionGroup.add(this.explosionLight);
        this.explosionGroup.visible = false;
        this.scene.add(this.explosionGroup);
    };
    private createFireballLayer = (
        geometry: THREE.BufferGeometry,
        color: number,
        renderOrder: number,
        maxScale: number,
        maxOpacity: number,
        delay: number,
        pulseSpeed: number,
        pulseOffset: number,
        pulseAmount: number,
        stretch: THREE.Vector3,
        rotationSpeed: THREE.Vector3,
    ): FireballLayer => {
        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            }),
        );
        mesh.visible = false;
        mesh.scale.setScalar(0.05);
        mesh.renderOrder = renderOrder;
        this.explosionGroup.add(mesh);
        return {
            mesh,
            maxScale,
            maxOpacity,
            delay,
            pulseSpeed,
            pulseOffset,
            pulseAmount,
            stretch,
            rotationSpeed,
        };
    };
    private startExplosion = (): void => {
        this.fortressState = "explosion";
        this.explosionElapsed = 0;
        this.fortressGroup.visible = false;
        this.explosionGroup.visible = true;
        for (const layer of this.fireballs) {
            layer.mesh.visible = true;
            layer.mesh.scale.setScalar(0.05);
            layer.mesh.material.opacity = layer.maxOpacity;
            layer.mesh.rotation.set(0, 0, 0);
        }
        this.explosionLight.intensity = 20;
        this.startShockwave();
        this.startSparkEffect();
        this.startDebrisEffect();
        this.startSmokeEffect();
    };
    private updateExplosion = (deltaTime: number): void => {
        if (this.fortressState !== "explosion") {
            return;
        }
        this.explosionElapsed += deltaTime;
        const progress = clamp01(this.explosionElapsed / CONFIG.explosionDuration);
        for (const layer of this.fireballs) {
            const localProgress = clamp01((progress - layer.delay) / (1 - layer.delay));
            if (localProgress <= 0) {
                layer.mesh.material.opacity = 0;
                layer.mesh.scale.setScalar(0.05);
                continue;
            }
            const growth = easeOut(localProgress, 3);
            const pulse = 1 + Math.sin(this.explosionElapsed * layer.pulseSpeed + layer.pulseOffset) * layer.pulseAmount;
            const scale = (0.08 + growth * layer.maxScale) * pulse;
            layer.mesh.scale.set(scale * layer.stretch.x, scale * layer.stretch.y, scale * layer.stretch.z);
            const fadeIn = THREE.MathUtils.smoothstep(localProgress, 0, 0.04);
            const fadeOut = 1 - THREE.MathUtils.smoothstep(localProgress, 0.12, 0.78);
            layer.mesh.material.opacity = layer.maxOpacity * fadeIn * fadeOut;
            layer.mesh.rotation.x += layer.rotationSpeed.x * deltaTime;
            layer.mesh.rotation.y += layer.rotationSpeed.y * deltaTime;
            layer.mesh.rotation.z += layer.rotationSpeed.z * deltaTime;
        }
        const lightFade = 1 - THREE.MathUtils.smoothstep(progress, 0.08, 0.8);
        this.explosionLight.intensity = lightFade * 26;
        if (progress >= 1) {
            for (const layer of this.fireballs) {
                layer.mesh.visible = false;
                layer.mesh.material.opacity = 0;
            }
            this.explosionLight.intensity = 0;
            this.explosionGroup.visible = false;
            this.fortressState = "aftermath";
        }
    };
    private createShockwaveEffect = (): void => {
        this.shockwaves = [
            this.createShockwaveLayer(0.988, 0xfff5e8, 17, 4.4, 0.95, 0, 5, 0.025, new THREE.Vector2(0.68, 1.55), 0.14),
            this.createShockwaveLayer(0.965, 0xffd6a0, 16, 4.35, 0.08, 0.005, 5, -0.015, new THREE.Vector2(0.7, 1.53), 0.1),
            this.createShockwaveLayer(0.94, 0xff8a60, 15, 4.3, 0.02, 0.01, 4, 0.01, new THREE.Vector2(0.72, 1.5), 0.08),
        ];
        this.shockwaveGroup.visible = false;
        this.scene.add(this.shockwaveGroup);
    };
    private createShockwaveLayer = (
        innerRadius: number,
        color: number,
        renderOrder: number,
        maxScale: number,
        maxOpacity: number,
        delay: number,
        easePower: number,
        rotationSpeed: number,
        stretch: THREE.Vector2,
        fadeStart: number,
    ): ShockwaveLayer => {
        const mesh = new THREE.Mesh(
            new THREE.RingGeometry(innerRadius, 1, 192),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
            }),
        );
        mesh.visible = false;
        mesh.scale.setScalar(0.05);
        mesh.renderOrder = renderOrder;
        this.shockwaveGroup.add(mesh);
        return {
            mesh,
            maxScale,
            maxOpacity,
            delay,
            easePower,
            rotationSpeed,
            stretch,
            fadeStart,
        };
    };
    private startShockwave = (): void => {
        this.shockwaveElapsed = 0;
        this.shockwaveGroup.visible = true;
        this.shockwaveGroup.quaternion.copy(this.camera.quaternion);
        this.shockwaveGroup.rotateZ(THREE.MathUtils.degToRad(3));
        for (const layer of this.shockwaves) {
            layer.mesh.visible = true;
            layer.mesh.material.opacity = 0;
            layer.mesh.rotation.z = 0;
            layer.mesh.scale.set(0.05 * layer.stretch.x, 0.05 * layer.stretch.y, 0.05);
        }
    };
    private updateShockwave = (deltaTime: number): void => {
        if (this.fortressState !== "explosion") {
            return;
        }
        this.shockwaveElapsed += deltaTime;
        const progress = clamp01(this.shockwaveElapsed / CONFIG.shockwaveDuration);
        for (const layer of this.shockwaves) {
            const localProgress = clamp01((progress - layer.delay) / (1 - layer.delay));
            if (localProgress <= 0) {
                layer.mesh.material.opacity = 0;
                continue;
            }
            const growth = easeOut(localProgress, layer.easePower);
            const scale = 0.05 + growth * layer.maxScale;
            layer.mesh.scale.set(scale * layer.stretch.x, scale * layer.stretch.y, scale);
            const fadeIn = THREE.MathUtils.smoothstep(localProgress, 0, 0.025);
            const fadeOut = 1 - THREE.MathUtils.smoothstep(localProgress, layer.fadeStart, 1);
            layer.mesh.material.opacity = layer.maxOpacity * fadeIn * fadeOut;
            layer.mesh.rotation.z += layer.rotationSpeed * deltaTime;
        }
        if (progress >= 1) {
            this.shockwaveGroup.visible = false;
            for (const layer of this.shockwaves) {
                layer.mesh.visible = false;
                layer.mesh.material.opacity = 0;
            }
        }
    };
    private getSparkPositionAttribute = (): THREE.BufferAttribute => this.sparkTrails.geometry.getAttribute("position") as THREE.BufferAttribute;
    private getSparkPositions = (): Float32Array => this.getSparkPositionAttribute().array as Float32Array;
    private createSparkEffect = (): void => {
        const positions = new Float32Array(CONFIG.sparkCount * 6);
        const colors = new Float32Array(CONFIG.sparkCount * 6);
        this.sparkVelocities = new Float32Array(CONFIG.sparkCount * 3);
        this.sparkAges = new Float32Array(CONFIG.sparkCount);
        this.sparkLives = new Float32Array(CONFIG.sparkCount);
        for (let i = 0; i < CONFIG.sparkCount; i++) {
            const vertexIndex = i * 6;
            const colorValue = Math.random();
            const headColor = new THREE.Color(colorValue < 0.2 ? 0xffffff : colorValue < 0.65 ? 0xffdb55 : 0xff6a18);
            const tailColor = headColor.clone().multiplyScalar(0.15);
            colors.set([tailColor.r, tailColor.g, tailColor.b, headColor.r, headColor.g, headColor.b], vertexIndex);
        }
        const geometry = new THREE.BufferGeometry();
        const positionAttribute = new THREE.BufferAttribute(positions, 3);
        positionAttribute.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute("position", positionAttribute);
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        this.sparkTrails = new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
            }),
        );
        this.sparkTrails.visible = false;
        this.sparkTrails.renderOrder = 25;
        this.sparkTrails.frustumCulled = false;
        this.scene.add(this.sparkTrails);
    };
    private startSparkEffect = (): void => {
        this.sparkElapsed = 0;
        this.sparkActive = true;
        this.sparkTrails.visible = true;
        this.sparkTrails.material.opacity = 1;
        const positions = this.getSparkPositions();
        for (let i = 0; i < CONFIG.sparkCount; i++) {
            const vertexIndex = i * 6;
            const velocityIndex = i * 3;
            const direction = new THREE.Vector3().randomDirection();
            const startPosition = direction.clone().multiplyScalar(THREE.MathUtils.randFloat(0, 0.3));
            positions.set([startPosition.x, startPosition.y, startPosition.z, startPosition.x, startPosition.y, startPosition.z], vertexIndex);
            let speed = THREE.MathUtils.randFloat(4, 11);
            if (Math.random() < 0.16) speed *= 1.7;
            this.sparkVelocities[velocityIndex] = direction.x * speed;
            this.sparkVelocities[velocityIndex + 1] = direction.y * speed;
            this.sparkVelocities[velocityIndex + 2] = direction.z * speed;
            this.sparkAges[i] = 0;
            this.sparkLives[i] = THREE.MathUtils.randFloat(1.2, 2.8);
        }
        this.getSparkPositionAttribute().needsUpdate = true;
    };
    private updateSparkEffect = (deltaTime: number): void => {
        if (!this.sparkActive) return;
        this.sparkElapsed += deltaTime;
        const positions = this.getSparkPositions();
        const drag = Math.pow(0.982, deltaTime * 60);
        let aliveCount = 0;
        for (let i = 0; i < CONFIG.sparkCount; i++) {
            const vertexIndex = i * 6;
            const velocityIndex = i * 3;
            this.sparkAges[i] += deltaTime;
            const lifeProgress = this.sparkAges[i] / this.sparkLives[i];
            if (lifeProgress >= 1) {
                positions[vertexIndex] = positions[vertexIndex + 3];
                positions[vertexIndex + 1] = positions[vertexIndex + 4];
                positions[vertexIndex + 2] = positions[vertexIndex + 5];
                continue;
            }
            aliveCount++;
            const vx = this.sparkVelocities[velocityIndex];
            const vy = this.sparkVelocities[velocityIndex + 1];
            const vz = this.sparkVelocities[velocityIndex + 2];
            const headX = positions[vertexIndex + 3] + vx * deltaTime;
            const headY = positions[vertexIndex + 4] + vy * deltaTime;
            const headZ = positions[vertexIndex + 5] + vz * deltaTime;
            const trailTime = THREE.MathUtils.lerp(0.075, 0.015, lifeProgress);
            positions[vertexIndex] = headX - vx * trailTime;
            positions[vertexIndex + 1] = headY - vy * trailTime;
            positions[vertexIndex + 2] = headZ - vz * trailTime;
            positions[vertexIndex + 3] = headX;
            positions[vertexIndex + 4] = headY;
            positions[vertexIndex + 5] = headZ;
            this.sparkVelocities[velocityIndex] *= drag;
            this.sparkVelocities[velocityIndex + 1] *= drag;
            this.sparkVelocities[velocityIndex + 2] *= drag;
        }
        this.getSparkPositionAttribute().needsUpdate = true;
        const progress = clamp01(this.sparkElapsed / CONFIG.sparkDuration);
        this.sparkTrails.material.opacity = 1 - THREE.MathUtils.smoothstep(progress, 0.15, 1);
        if (aliveCount === 0 || progress >= 1) {
            this.sparkActive = false;
            this.sparkTrails.visible = false;
            this.sparkTrails.material.opacity = 0;
        }
    };
    private resetSparkEffect = (): void => {
        this.sparkElapsed = 0;
        this.sparkActive = false;
        this.sparkTrails.visible = false;
        this.sparkTrails.material.opacity = 0;
        this.getSparkPositions().fill(0);
        this.sparkVelocities.fill(0);
        this.sparkAges.fill(0);
        this.sparkLives.fill(0);
        this.getSparkPositionAttribute().needsUpdate = true;
    };
    private createDebrisEffect = (): void => {
        this.debrisMaterial = new THREE.MeshStandardMaterial({
            color: 0x555b65,
            roughness: 0.78,
            metalness: 0.5,
            transparent: true,
            opacity: 1,
        });
        for (let i = 0; i < CONFIG.debrisCount; i++) {
            const width = THREE.MathUtils.randFloat(0.12, 0.55);
            const height = THREE.MathUtils.randFloat(0.08, 0.42);
            const depth = THREE.MathUtils.randFloat(0.06, 0.35);
            const resetX = this.getDebrisResetX(i);
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.debrisMaterial);
            mesh.visible = false;
            mesh.position.set(resetX, 0, 0);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            const shape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2));
            const mass = Math.max(0.15, width * height * depth * 18);
            const body = new CANNON.Body({ mass, shape });
            body.position.set(resetX, 0, 0);
            body.linearDamping = 0.015;
            body.angularDamping = 0.025;
            body.allowSleep = false;
            this.physicsWorld.addBody(body);
            this.debrisItems.push({ mesh, body });
        }
    };
    private getDebrisResetX = (index: number): number => 100 + index * 2;
    private resetDebrisBody = (item: DebrisItem, x: number): void => {
        const { mesh, body } = item;
        mesh.visible = false;
        mesh.position.set(x, 0, 0);
        mesh.quaternion.identity();
        body.position.set(x, 0, 0);
        body.quaternion.set(0, 0, 0, 1);
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
        body.force.set(0, 0, 0);
        body.torque.set(0, 0, 0);
        body.aabbNeedsUpdate = true;
    };
    private syncDebris = (item: DebrisItem): void => {
        item.mesh.position.set(item.body.position.x, item.body.position.y, item.body.position.z);
        item.mesh.quaternion.set(item.body.quaternion.x, item.body.quaternion.y, item.body.quaternion.z, item.body.quaternion.w);
    };
    private startDebrisEffect = (): void => {
        this.debrisElapsed = 0;
        this.debrisActive = true;
        this.debrisMaterial.opacity = 1;
        for (const item of this.debrisItems) {
            const { mesh, body } = item;
            const direction = new THREE.Vector3().randomDirection();
            const startRadius = THREE.MathUtils.randFloat(0.25, 1.8);
            let speed = THREE.MathUtils.randFloat(2.8, 7.5);
            if (Math.random() < 0.18) speed *= 1.7;
            body.position.set(direction.x * startRadius, direction.y * startRadius, direction.z * startRadius);
            body.velocity.set(0, 0, 0);
            body.angularVelocity.set(0, 0, 0);
            body.force.set(0, 0, 0);
            body.torque.set(0, 0, 0);
            body.quaternion.setFromEuler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
            body.applyImpulse(
                new CANNON.Vec3(direction.x * speed * body.mass, direction.y * speed * body.mass, direction.z * speed * body.mass),
                new CANNON.Vec3(THREE.MathUtils.randFloatSpread(0.18), THREE.MathUtils.randFloatSpread(0.18), THREE.MathUtils.randFloatSpread(0.18)),
            );
            body.angularVelocity.set(THREE.MathUtils.randFloatSpread(7), THREE.MathUtils.randFloatSpread(7), THREE.MathUtils.randFloatSpread(7));
            body.aabbNeedsUpdate = true;
            body.wakeUp();
            mesh.visible = true;
            this.syncDebris(item);
        }
    };
    private updateDebrisEffect = (deltaTime: number): void => {
        if (!this.debrisActive) return;
        this.debrisElapsed += deltaTime;
        this.physicsWorld.step(CONFIG.fixedTimeStep, Math.min(deltaTime, 0.1), 3);
        for (const item of this.debrisItems) this.syncDebris(item);
        const progress = clamp01(this.debrisElapsed / CONFIG.debrisDuration);
        this.debrisMaterial.opacity = 1 - THREE.MathUtils.smoothstep(progress, 0.58, 1);
        if (progress >= 1) {
            this.debrisActive = false;
            this.debrisMaterial.opacity = 0;
            for (const item of this.debrisItems) item.mesh.visible = false;
        }
    };
    private createSmokeTexture = (): THREE.CanvasTexture => {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("煙テクスチャ用のCanvasを作成できませんでした。");
        }
        const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
        gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
        gradient.addColorStop(0.2, "rgba(255, 255, 255, 0.9)");
        gradient.addColorStop(0.5, "rgba(200, 200, 200, 0.5)");
        gradient.addColorStop(0.75, "rgba(100, 100, 100, 0.2)");
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        return new THREE.CanvasTexture(canvas);
    };
    private createSmokeEffect = (): void => {
        const texture = this.createSmokeTexture();
        for (let i = 0; i < CONFIG.smokeCount; i++) {
            const sprite = new THREE.Sprite(
                new THREE.SpriteMaterial({
                    map: texture,
                    color: COLORS.smokeHot,
                    transparent: true,
                    opacity: 0,
                    depthWrite: false,
                    depthTest: true,
                    blending: THREE.NormalBlending,
                }),
            );
            sprite.visible = false;
            sprite.scale.setScalar(0.1);
            sprite.renderOrder = 16;
            this.smokeGroup.add(sprite);
            this.smokeParticles.push({
                sprite,
                velocity: new THREE.Vector3(),
                rotationSpeed: 0,
                delay: 0,
                life: 1,
                startScale: 0.1,
                endScale: 1,
                baseOpacity: 0.6,
            });
        }
        this.smokeGroup.visible = false;
        this.scene.add(this.smokeGroup);
    };
    private startSmokeEffect = (): void => {
        this.smokeElapsed = 0;
        this.smokeActive = true;
        this.smokeGroup.visible = true;
        for (const particle of this.smokeParticles) {
            const direction = new THREE.Vector3(
                THREE.MathUtils.randFloatSpread(0.7),
                THREE.MathUtils.randFloatSpread(2.6),
                THREE.MathUtils.randFloatSpread(0.7),
            ).normalize();
            const startRadius = THREE.MathUtils.randFloat(0.1, 1.0);
            const speed = THREE.MathUtils.randFloat(0.25, 0.85);
            particle.sprite.position.copy(direction).multiplyScalar(startRadius);
            particle.velocity.copy(direction).multiplyScalar(speed);
            particle.velocity.x += THREE.MathUtils.randFloatSpread(0.18);
            particle.velocity.y += THREE.MathUtils.randFloatSpread(0.3);
            particle.velocity.z += THREE.MathUtils.randFloatSpread(0.18);
            particle.delay = THREE.MathUtils.randFloat(0.0, 0.18);
            particle.life = THREE.MathUtils.randFloat(3.5, 5.5);
            particle.startScale = THREE.MathUtils.randFloat(0.8, 1.4);
            particle.endScale = THREE.MathUtils.randFloat(4.5, 7.5);
            particle.baseOpacity = THREE.MathUtils.randFloat(0.58, 0.85);
            particle.rotationSpeed = THREE.MathUtils.randFloatSpread(0.9);
            particle.sprite.visible = false;
            particle.sprite.scale.setScalar(particle.startScale);
            particle.sprite.material.opacity = 0;
            particle.sprite.material.color.copy(COLORS.smokeHot);
            particle.sprite.material.rotation = Math.random() * Math.PI * 2;
        }
    };
    private updateSmokeEffect = (deltaTime: number): void => {
        if (!this.smokeActive) return;
        this.smokeElapsed += deltaTime;
        const drag = Math.pow(0.992, deltaTime * 60);
        let allFinished = true;
        for (let i = 0; i < this.smokeParticles.length; i++) {
            const particle = this.smokeParticles[i];
            const localTime = this.smokeElapsed - particle.delay;
            if (localTime < 0) {
                allFinished = false;
                continue;
            }
            const progress = clamp01(localTime / particle.life);
            if (progress < 1) allFinished = false;
            particle.sprite.visible = progress < 1;
            if (progress >= 1) {
                particle.sprite.material.opacity = 0;
                continue;
            }
            particle.sprite.position.addScaledVector(particle.velocity, deltaTime);
            particle.velocity.multiplyScalar(drag);
            particle.sprite.position.x += Math.sin(localTime * 2.1 + i) * 0.015 * deltaTime;
            particle.sprite.position.y += Math.cos(localTime * 1.7 + i) * 0.015 * deltaTime;
            particle.sprite.material.rotation += particle.rotationSpeed * deltaTime;
            const growth = easeOut(progress);
            const scale = THREE.MathUtils.lerp(particle.startScale, particle.endScale, growth) * (1 + Math.sin(localTime * 3 + i) * 0.06);
            particle.sprite.scale.set(scale * 0.82, scale * 1.35, 1);
            const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.12);
            const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.35, 1);
            particle.sprite.material.opacity = particle.baseOpacity * fadeIn * fadeOut;
            if (progress < 0.3) {
                particle.sprite.material.color.copy(COLORS.smokeHot).lerp(COLORS.smokeMiddle, progress / 0.3);
            } else {
                particle.sprite.material.color.copy(COLORS.smokeMiddle).lerp(COLORS.smokeCold, (progress - 0.3) / 0.7);
            }
        }
        if (allFinished) {
            this.smokeActive = false;
            this.smokeGroup.visible = false;
        }
    };
    private setupInput = (): void => {
        window.addEventListener("keydown", this.onKeyDown);
    };
    private onKeyDown = (event: KeyboardEvent): void => {
        if (event.repeat) return;
        if (event.code === "Space") {
            event.preventDefault();
            this.startWarning();
        } else if (event.code === "KeyR") {
            this.resetFortress();
        }
    };
    private resetFortress = (): void => {
        this.fortressState = "idle";
        this.warningElapsed = 0;
        this.flashElapsed = 0;
        this.explosionElapsed = 0;
        this.shockwaveElapsed = 0;
        this.sparkElapsed = 0;
        this.debrisElapsed = 0;
        this.smokeElapsed = 0;
        this.fortressGroup.visible = true;
        this.fortressGroup.rotation.set(0, 0, THREE.MathUtils.degToRad(-8));
        this.bodyMaterial.emissive.setHex(COLORS.fortressEmissive);
        this.bodyMaterial.emissiveIntensity = 0;
        this.warningGlow.visible = true;
        this.warningGlow.material.opacity = 0;
        this.warningGlow.scale.setScalar(0.1);
        this.warningLight.intensity = 0;
        this.flashMesh.visible = false;
        this.flashMesh.material.opacity = 0;
        this.flashMesh.scale.setScalar(0.05);
        this.flashLight.intensity = 0;
        this.explosionGroup.visible = false;
        for (const layer of this.fireballs) {
            layer.mesh.visible = false;
            layer.mesh.material.opacity = 0;
            layer.mesh.scale.setScalar(0.05);
            layer.mesh.rotation.set(0, 0, 0);
        }
        this.explosionLight.intensity = 0;
        this.shockwaveGroup.visible = false;
        this.shockwaveGroup.quaternion.identity();
        this.shockwaveGroup.rotation.set(0, 0, 0);
        for (const layer of this.shockwaves) {
            layer.mesh.visible = false;
            layer.mesh.material.opacity = 0;
            layer.mesh.scale.setScalar(0.1);
            layer.mesh.rotation.z = 0;
        }
        this.resetSparkEffect();
        this.debrisActive = false;
        this.debrisMaterial.opacity = 1;
        this.debrisItems.forEach((item, index) => this.resetDebrisBody(item, this.getDebrisResetX(index)));
        this.smokeActive = false;
        this.smokeGroup.visible = false;
        for (const particle of this.smokeParticles) {
            particle.sprite.visible = false;
            particle.sprite.position.set(0, 0, 0);
            particle.sprite.scale.setScalar(0.1);
            particle.sprite.material.opacity = 0;
            particle.sprite.material.rotation = 0;
            particle.sprite.material.color.copy(COLORS.smokeHot);
            particle.velocity.set(0, 0, 0);
        }
    };
    private startAnimation = (): void => {
        const animate = (): void => {
            requestAnimationFrame(animate);
            const deltaTime = Math.min(this.clock.getDelta(), 0.1);
            this.updateWarning(deltaTime);
            this.updateFlash(deltaTime);
            this.updateExplosion(deltaTime);
            this.updateShockwave(deltaTime);
            this.updateSparkEffect(deltaTime);
            this.updateDebrisEffect(deltaTime);
            this.updateSmokeEffect(deltaTime);
            if (this.fortressGroup.visible) {
                this.fortressGroup.rotation.y += deltaTime * CONFIG.fortressRotationSpeed;
            }
            this.orbitControls.update();
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    };
    private onWindowResize = (): void => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };
}
window.addEventListener("DOMContentLoaded", () => {
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    document.body.style.backgroundColor = "#000008";
    const container = new ThreeJSContainer();
    document.body.appendChild(container.createRendererDOM(window.innerWidth, window.innerHeight, new THREE.Vector3(6, 4, 8)));
    const guide = document.createElement("div");
    guide.textContent = "Space：爆破　R：もう一度";
    Object.assign(guide.style, {
        position: "fixed",
        left: "20px",
        bottom: "20px",
        padding: "10px 16px",
        color: "#ffffff",
        backgroundColor: "rgba(0, 0, 0, 0.55)",
        border: "1px solid rgba(255, 255, 255, 0.35)",
        borderRadius: "8px",
        fontFamily: "sans-serif",
        fontSize: "14px",
        pointerEvents: "none",
    });
    document.body.appendChild(guide);
});
