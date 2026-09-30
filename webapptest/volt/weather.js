import * as THREE from 'three';
import {
  Fn,
  float,
  vec3,
  vec4,
  uniform,
  texture3D,
  smoothstep,
  mix,
  exp,
  clamp,
  attribute,
  positionGeometry,
  fract,
  cameraPosition,
  uv,
  modelWorldMatrix,
  If,
  Break
} from 'three/tsl';

import {
  RaymarchingBox
} from './vendor/Raymarching.js';

import {
  ImprovedNoise
} from './vendor/ImprovedNoise.js';


export class Weather {

  constructor(scene, eco) {

    this.scene = scene;

    this.clock =
      uniform(0);

    this.cloudOffset =
      uniform(
        new THREE.Vector3()
      );

    this.density =
      uniform(.85);

    this.flash =
      uniform(0);

    this.flashAt =
      uniform(
        new THREE.Vector3()
      );

    this.cloudTint =
      uniform(
        new THREE.Color(
          .12,
          .15,
          .18
        )
      );

    this.wind =
      uniform(
        new THREE.Vector3(
          12,
          -70,
          3
        )
      );

    this.right =
      uniform(
        new THREE.Vector3(
          1,
          0,
          0
        )
      );

    this.rainAmount =
      uniform(.7);

    this.eco = eco;

    this.createClouds();
    this.createRain();
    this.createCurtains();
  }


  /* ============================================================
     Clouds
     ============================================================ */

  createClouds() {

    const size = 64;

    const data =
      new Uint8Array(
        size ** 3
      );

    const noise =
      new ImprovedNoise();

    let i = 0;


    for (
      let z = 0;
      z < size;
      z++
    ) {

      for (
        let y = 0;
        y < size;
        y++
      ) {

        for (
          let x = 0;
          x < size;
          x++
        ) {

          const a =
            noise.noise(
              x / 14,
              y / 18,
              z / 14
            );

          const b =
            noise.noise(
              x / 6 + 31,
              y / 8,
              z / 6
            );

          const c =
            noise.noise(
              x / 2.8,
              y / 3.2,
              z / 2.8
            );


          data[i++] =
            Math.max(
              0,
              Math.min(
                255,
                (
                  .52 +
                  a * .37 +
                  b * .15 +
                  c * .06
                ) * 255
              )
            );
        }
      }
    }


    const tex =
      new THREE.Data3DTexture(
        data,
        size,
        size,
        size
      );


    tex.format =
      THREE.RedFormat;

    tex.minFilter =
      THREE.LinearFilter;

    tex.magFilter =
      THREE.LinearFilter;

    tex.unpackAlignment = 1;

    tex.wrapS =
      THREE.RepeatWrapping;

    tex.wrapT =
      THREE.RepeatWrapping;

    tex.wrapR =
      THREE.RepeatWrapping;

    tex.needsUpdate =
      true;


    this.volumeTexture =
      tex;


    this.makeCloudMaterial();
  }


  makeCloudMaterial() {

    if (this.clouds) {

      this.scene.remove(
        this.clouds
      );

      this.clouds.geometry.dispose();
      this.clouds.material.dispose();
    }


    const steps =
      this.eco
        ? 28
        : 52;


    const tex =
      this.volumeTexture;


    const material =
      new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false
      });


    material.colorNode =
      Fn(() => {

        const sum =
          vec4(0).toVar();


        RaymarchingBox(
          steps,
          ({
            positionRay: p
          }) => {

            const q =
              p.add(.5);


            const drift =
              vec3(
                this.clock.mul(.00032),
                0,
                this.clock.mul(.0001)
              )
              .add(
                this.cloudOffset
              );


            const n =
              texture3D(
                tex,

                q.mul(
                  vec3(
                    2.3,
                    1,
                    2.3
                  )
                )
                .add(drift)
              ).r;


            const envelope =
              smoothstep(
                0,
                .18,
                q.y
              )

              .mul(
                smoothstep(
                  0,
                  .2,
                  float(1).sub(q.y)
                )
              )

              .mul(
                float(1).sub(
                  smoothstep(
                    .35,
                    .5,
                    p.x.abs()
                  )
                )
              )

              .mul(
                float(1).sub(
                  smoothstep(
                    .35,
                    .5,
                    p.z.abs()
                  )
                )
              );


            const d =
              smoothstep(
                float(.64)
                  .sub(
                    this.density.mul(.3)
                  ),
                .72,
                n
              )
              .mul(
                envelope
              );


            const alpha =
              float(1)
                .sub(
                  exp(
                    d.mul(
                      -11 / steps
                    )
                  )
                );


            const upper =
              texture3D(
                tex,

                q.mul(
                  vec3(
                    2.3,
                    1,
                    2.3
                  )
                )
                .add(drift)
                .add(
                  vec3(
                    0,
                    .045,
                    0
                  )
                )
              ).r;


            const shade =
              clamp(
                n
                  .sub(upper)
                  .mul(2)
                  .add(
                    q.y.mul(.3)
                  )
                  .add(.32),

                .12,
                1
              );


            const world =
              modelWorldMatrix
                .mul(
                  vec4(
                    p,
                    1
                  )
                )
                .xyz;


            const dist =
              world
                .sub(
                  this.flashAt
                )
                .length();


            const light =
              this.flash
                .mul(
                  exp(
                    dist.mul(
                      -.0007
                    )
                  )
                )
                .mul(3.5);


            const rgb =
              this.cloudTint
                .mul(shade)
                .add(
                  vec3(
                    .58,
                    .7,
                    1
                  )
                  .mul(light)
                );


            const weight =
              float(1)
                .sub(sum.a)
                .mul(alpha);


            sum.rgb.addAssign(
              rgb.mul(weight)
            );

            sum.a.addAssign(
              weight
            );


            If(
              sum.a.greaterThan(.98),
              () => {
                Break();
              }
            );
          }
        );


        return vec4(
          sum.rgb.div(
            sum.a.max(.001)
          ),
          sum.a
        );

      })();


    this.clouds =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          1,
          1,
          1
        ),
        material
      );


    this.clouds.scale.set(
      26000,
      3600,
      26000
    );


    this.clouds.position.set(
      0,
      4100,
      0
    );


    this.clouds.renderOrder =
      1;


    this.scene.add(
      this.clouds
    );
  }


  /* ============================================================
     Rain
     ============================================================ */

  createRain() {

    const n = 22000;


    const g =
      new THREE.InstancedBufferGeometry();


    g.setAttribute(
      'position',

      new THREE.Float32BufferAttribute(
        [
          -.5, 0, 0,
           .5, 0, 0,
          -.5, 1, 0,
           .5, 1, 0
        ],
        3
      )
    );


    /*
      ★ WebGPU / TSL修正

      MeshBasicNodeMaterial内部でnormalGeometryが
      参照されるケースがあるため、
      Rain quadにも明示的にnormalを与える。

      4頂点すべて +Z。
    */
    g.setAttribute(
      'normal',

      new THREE.Float32BufferAttribute(
        [
          0, 0, 1,
          0, 0, 1,
          0, 0, 1,
          0, 0, 1
        ],
        3
      )
    );


    g.setAttribute(
      'uv',

      new THREE.Float32BufferAttribute(
        [
          0, 0,
          1, 0,
          0, 1,
          1, 1
        ],
        2
      )
    );


    g.setIndex(
      [
        0, 1, 2,
        2, 1, 3
      ]
    );


    const seeds =
      new Float32Array(
        n * 4
      );


    for (
      let i = 0;
      i < seeds.length;
      i++
    ) {

      seeds[i] =
        Math.random();
    }


    g.setAttribute(
      'seed',

      new THREE.InstancedBufferAttribute(
        seeds,
        4
      )
    );


    g.instanceCount =
      this.eco
        ? 6000
        : 15000;


    const m =
      new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true
      });


    const s =
      attribute(
        'seed',
        'vec4'
      );


    const speed =
      s.w
        .mul(.65)
        .add(.65);


    const area =
      vec3(
        1100,
        900,
        1100
      );


    const motion =
      this.wind
        .mul(
          this.clock
        )
        .mul(
          speed
        );


    const p =
      fract(
        s.xyz
          .mul(area)
          .add(motion)
          .sub(
            cameraPosition
          )
          .div(area)
      )
      .mul(area)
      .add(
        cameraPosition
      )
      .sub(
        area.mul(.5)
      );


    m.positionNode =
      p
        .add(
          this.right
            .mul(
              positionGeometry.x
            )
            .mul(
              s.w
                .mul(.09)
                .add(.06)
            )
        )

        .add(
          this.wind
            .mul(
              positionGeometry.y
            )
            .mul(
              s.w
                .mul(.025)
                .add(.025)
            )
        );


    m.colorNode =
      vec3(
        .55,
        .68,
        .78
      )
      .mul(
        this.flash
          .mul(3)
          .add(.65)
      );


    m.opacityNode =
      float(.26)
        .mul(
          this.rainAmount
        )
        .mul(
          float(1)
            .sub(
              uv().y
            )
            .mul(.7)
            .add(.3)
        );


    this.rain =
      new THREE.Mesh(
        g,
        m
      );


    this.rain.frustumCulled =
      false;


    this.rain.renderOrder =
      2;


    this.scene.add(
      this.rain
    );
  }


  /* ============================================================
     Update
     ============================================================ */

  update(
    t,
    camera,
    rain,
    wind,
    cloud,
    flash,
    at
  ) {

    this.clock.value =
      t;


    this.density.value =
      cloud / 100;


    this.flash.value =
      flash;


    this.flashAt.value.copy(
      at
    );


    const gust =
      1 +
      .4 * Math.sin(t * .7) +
      .15 * Math.sin(t * 1.9);


    this.wind.value.set(
      wind * gust,
      -75,
      wind *
      .28 *
      Math.sin(t * .12)
    );


    this.right.value
      .set(
        1,
        0,
        0
      )
      .applyQuaternion(
        camera.quaternion
      );


    this.rainAmount.value =
      Math.min(
        1,
        rain / 90
      );


    this.rain.geometry.instanceCount =
      rain === 0

        ? 0

        : Math.floor(
            (
              this.eco
                ? 9000
                : 22000
            )
            *
            Math.min(
              1,
              rain / 120
            )
          );


    this.clouds.position.x =
      camera.position.x;


    this.clouds.position.z =
      camera.position.z;


    this.cloudOffset.value.set(

      camera.position.x /
      26000 *
      2.3,

      0,

      camera.position.z /
      26000 *
      2.3
    );


    this.curtains.visible =
      rain > 0;
  }


  /* ============================================================
     Rain curtains
     ============================================================ */

  createCurtains() {

    this.curtains =
      new THREE.Group();


    const material =
      new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true
      });


    const noise =
      texture3D(

        this.volumeTexture,

        vec3(
          uv().x
            .mul(3)
            .add(
              this.clock.mul(.002)
            ),

          uv().y.mul(.12),

          .5
        )

      ).r;


    material.colorNode =
      vec3(
        .1,
        .13,
        .17
      )
      .add(
        vec3(
          .45,
          .55,
          .8
        )
        .mul(
          this.flash
        )
      );


    material.opacityNode =
      smoothstep(
        .3,
        .7,
        noise
      )

      .mul(
        smoothstep(
          0,
          .2,
          uv().y
        )
      )

      .mul(
        float(1)
          .sub(
            smoothstep(
              .8,
              1,
              uv().y
            )
          )
      )

      .mul(
        this.rainAmount
      )

      .mul(.2);


    for (
      const [x, z, r]
      of [
        [-3400, -2400, 1900],
        [1700, -4500, 2400],
        [4800, 800, 1500]
      ]
    ) {

      const mesh =
        new THREE.Mesh(

          new THREE.CylinderGeometry(
            r * .8,
            r,
            2400,
            24,
            1,
            true
          ),

          material
        );


      mesh.position.set(
        x,
        1350,
        z
      );


      this.curtains.add(
        mesh
      );
    }


    this.scene.add(
      this.curtains
    );
  }


  /* ============================================================
     Quality
     ============================================================ */

  setQuality(eco) {

    if (
      eco === this.eco
    ) {
      return;
    }


    this.eco =
      eco;


    this.makeCloudMaterial();
  }
}