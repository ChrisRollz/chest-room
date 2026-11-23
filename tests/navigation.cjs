const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const THREE = require("../src/vendor/three.min.js");

async function run() {
  const source = await fs.readFile(
    path.join(__dirname, "../src/geometry.js"),
    "utf8",
  );
  const geometry = new Function("THREE", source + "\nreturn ChestGeometry;")(
    THREE,
  );
  const makeFile = (name, shape) => ({
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(geometry.stl(new THREE.Mesh(shape))),
  });
  const scan =
    process.argv[3] ||
    makeFile("Demo torso.stl", geometry.mannequin(geometry.defaults).geometry);
  const front =
    process.argv[2] ||
    makeFile("Front.stl", new THREE.BoxGeometry(330, 20, 365));
  const back = makeFile("Back.stl", new THREE.BoxGeometry(315, 26, 380));
  const initial =
    typeof front === "string" ? await fs.readFile(front) : front.buffer;
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1232, height: 810 },
      acceptDownloads: true,
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const button = (name) => page.getByRole("button", { name, exact: true });
    const click = (name) => button(name).click();
    async function choose(label, file) {
      const ready = page.waitForEvent("filechooser");
      await click(label);
      await (await ready).setFiles(file);
    }
    async function download() {
      const ready = page.waitForEvent("download");
      await click("Download fitted plate");
      const result = await ready;
      return fs.readFile(await result.path());
    }
    const until = (text) =>
      page.getByRole("heading", { name: text, exact: true }).waitFor();
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../dist/preview.html")).href,
    );
    await click("Saved fits");
    await click("Torsos");
    await choose("Use torso STL", {
      name: "Broken.stl",
      buffer: Buffer.from("broken"),
      mimeType: "application/octet-stream",
    });
    await page.getByText("Choose a complete binary or ASCII STL.").waitFor();
    await click("Make my torso");
    const input = page.getByLabel("Your measurement");
    await input.fill("0");
    assert(await button("Next").isDisabled());
    for (const [i, value] of ["96", "23.5", "80", "41", "40.5"].entries()) {
      await input.fill(value);
      if (i === 1 && process.env.CHEST_SCREENSHOT)
        await page.screenshot({ path: process.env.CHEST_SCREENSHOT });
      await click(i === 4 ? "Review torso" : "Next");
    }
    await page.getByLabel("Torso name").fill("Demo torso");
    await click("Save and fit armor");
    await until("Try on armor");
    await choose("Add front plate", front);
    await until("Fit armor");
    await click("Rotate");
    await click("Orbit");
    await click("Move");
    await page.getByLabel("Plate scale (%)").fill("110");
    await choose("Add back plate", back);
    await button("Back plate").waitFor();
    assert.equal(
      await button("Back plate").getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("checkbox", { name: "Preview foam pads" }).check();
    await page.locator("#foam").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#foam").inputValue(), "7");
    await page.getByLabel("Plate scale (%)").fill("90");
    await click("Top cut");
    await click("Measure gap");
    const cutCanvas = page.locator("#cut");
    const points = await cutCanvas.evaluate(async canvas => {
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const {width,height}=canvas, pixels=canvas.getContext("2d").getImageData(0,0,width,height).data;
      const match = color => {
        for(let x=Math.floor(width/2);x<Math.ceil(width*.7);x++){
          for(let y=0;y<Math.floor(height/2);y++){
            const i=4*(y*width+x);
            if(pixels[i+3]>140 && color.every((c,k)=>Math.abs(pixels[i+k]-c)<5))
              return {x:(x+.5)*canvas.clientWidth/width,y:(y+.5)*canvas.clientHeight/height};
          }
        }
        throw Error("Expected cross-section outline is missing.");
      };
      return [match([244,214,139]),match([168,173,239])];
    });
    for(const position of points)await cutCanvas.click({position});
    await page.getByText(/\d+\.\d mm between these points/).waitFor();
    await click("3D");
    await click("Front plate");
    assert.equal(await page.getByLabel("Plate scale (%)").inputValue(), "110");
    for (const mode of ["Front cut", "Side cut", "Top cut"]) {
      await click(mode);
      await page.locator("#slice").focus();
      await page.keyboard.press("ArrowUp");
      await click("Measure gap");
      await click("Measure gap");
      const rect = await page.locator("#cut").boundingBox();
      await page.mouse.move(
        rect.x + rect.width * 0.4,
        rect.y + rect.height * 0.5,
      );
      await page.mouse.down();
      await page.mouse.move(
        rect.x + rect.width * 0.42,
        rect.y + rect.height * 0.53,
        { steps: 2 },
      );
      await page.mouse.up();
    }
    await click("3D");
    await page.getByText("Precise alignment", { exact: true }).click();
    await page.getByLabel("Z (°)", { exact: true }).fill("21");
    const refReady=page.waitForEvent("download");
    await click("Save shoulder reference for Arm Room");
    const ref=await fs.readFile(await (await refReady).path());
    assert.equal(ref.toString("ascii",0,12),"ROOMSHOULDER");
    assert.equal(ref.readUInt32LE(12),1);
    assert.equal(ref.readFloatLE(16),205);
    assert.equal(ref.readFloatLE(28),-205);
    assert.equal(ref.readUInt32LE(80),initial.readUInt32LE(80)+back.buffer.readUInt32LE(80));
    if(process.env.CHEST_REFERENCE_STL)await fs.writeFile(process.env.CHEST_REFERENCE_STL,ref);
    await click("Reset this plate");
    assert.equal(await page.getByLabel("Plate scale (%)").inputValue(), "100");
    await page.getByLabel("Plate scale (%)").fill("107");
    await click("Back plate");
    assert.equal(await page.getByLabel("Plate scale (%)").inputValue(), "90");
    await click("Front plate");
    await click("Save fit…");
    await click("Cancel");
    await click("Save fit…");
    await page.getByLabel("Fit name").fill("Demo cuirass");
    await click("Save version");
    await page.getByText("Saved Demo cuirass · v1.").waitFor();
    const fitted = await download();
    assert.equal(fitted.readUInt32LE(80), initial.readUInt32LE(80));
    assert.equal(fitted.length, initial.length);
    assert(!fitted.equals(initial));
    if (process.env.CHEST_FITTED_STL)
      await fs.writeFile(process.env.CHEST_FITTED_STL, fitted);
    await page.reload();
    await click("Saved fits");
    await page.getByRole("button", { name: /Demo cuirass · v1/ }).click();
    await until("Fit armor");
    assert((await download()).equals(fitted));
    assert(
      await page
        .getByRole("checkbox", { name: "Preview foam pads" })
        .isChecked(),
    );
    assert.equal(await page.locator("#foam").inputValue(), "7");
    await click("Back plate");
    assert.equal(await page.getByLabel("Plate scale (%)").inputValue(), "90");
    await click("Save fit…");
    assert.equal(
      await page.getByLabel("Version", { exact: true }).inputValue(),
      "v2",
    );
    await click("Save version");
    await page.getByText("Saved Demo cuirass · v2.").waitFor();
    await click("Library");
    await click("Torsos");
    await page.getByRole("button", { name: /Demo torso.*960 mm/ }).click();
    await click("Modify torso");
    assert.equal(await input.inputValue(), "96");
    await input.fill("98");
    for (let i = 0; i < 4; i++) await click("Next");
    await click("Review torso");
    await click("Save and fit armor");
    await click("Library");
    assert.equal(
      await page.getByRole("button", { name: /Demo torso.*mm chest/ }).count(),
      2,
    );
    await choose("Use torso STL", scan);
    await until("Save your torso");
    await page.getByLabel("Torso name").fill("Demo scan");
    await click("Save and fit armor");
    await choose("Add back plate", back);
    await until("Fit armor");
    await page.getByRole("checkbox", { name: "Preview foam pads" }).check();
    assert.equal((await download()).length, back.buffer.length);
    assert.deepEqual(errors, []);
    console.log(
      "Passed measured and scanned torsos, additive revision, dual plates, all cuts, tools, version persistence and full-mesh export (" +
        fitted.readUInt32LE(80) +
        " front triangles).",
    );
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
