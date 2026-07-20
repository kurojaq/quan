/* ============================================================================
   Qu'an Smoke Test  —  minimal graphics-API render check
   ----------------------------------------------------------------------------
   Purpose: confirm the declarative graphics pipeline actually paints on THIS
   Tradovate build, using only documented GraphicsObjects. Draws three things
   at the LAST bar so the chart stays clean:
     1. Text        "QU'AN OK"      (proven in the Graphics tutorial)
     2. Shapes/Circle a filled dot   (proven in the Graphics tutorial)
     3. Instancing   5 colored rects (the primitive the Bookmap field needs)

   If you SEE all three -> the graphics path + Instancing work; the Bookmap will
   render. If you see Text+dot but NOT the colored rects -> Instancing is the
   problem and the field must fall back to per-cell Shapes/Dots.
   If you see NOTHING -> the graphics pipeline itself isn't rendering; check the
   Code Explorer error console and tell me what it says.

   Load: Code Explorer -> new indicator -> paste -> save -> add to chart.
   ============================================================================ */
const predef = require("./tools/predef");
const { px, du, op } = require("./tools/graphics");

class quanSmokeTest {
    map(d) {
        if (!d.isLast()) return {};
        const x = d.index();
        const y = d.value();

        // 5 stacked rectangles just left of the last bar, rainbow colored
        const inst = [];
        const colors = [
            { r: 1, g: 0.2, b: 0.2 }, { r: 1, g: 0.6, b: 0.1 },
            { r: 0.2, g: 0.9, b: 0.3 }, { r: 0.2, g: 0.6, b: 1 },
            { r: 0.7, g: 0.3, b: 1 }
        ];
        for (let i = 0; i < colors.length; i++) {
            inst.push({
                position: { x: op(du(x), '-', px(80)), y: op(du(y), '+', px(-40 + i * 18)) },
                size: { width: px(60), height: px(16) },
                color: colors[i]
            });
        }

        return {
            graphics: {
                items: [
                    {
                        tag: "Text", key: "q_txt",
                        point: { x: op(du(x), '-', px(6)), y: op(du(y), '-', px(70)) },
                        text: "QU'AN OK",
                        style: { fontSize: 16, fontWeight: "bold", fill: "#ffd24a" },
                        textAlignment: "centerMiddle"
                    },
                    {
                        tag: "Shapes", key: "q_dot",
                        primitives: [
                            { tag: "Circle", radius: 8, center: { x: du(x), y: op(du(y), '-', px(44)) } }
                        ],
                        fillStyle: { color: "#ff6a4a" }
                    },
                    {
                        tag: "Instancing", key: "q_inst",
                        instances: inst
                    }
                ]
            }
        };
    }
}

module.exports = {
    name: "quanSmokeTest",
    description: "Qu'an Smoke Test — graphics pipeline check",
    calculator: quanSmokeTest,
    tags: ["Qu'an"],
    inputType: "bars",
    areaChoice: "overlay"
};
