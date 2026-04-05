import Phaser from "phaser";

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("PreloadScene");
  }

  preload(): void {
    const progressBox = this.add.rectangle(480, 360, 360, 24, 0x1a1d1f, 0.4);
    const progressBar = this.add.rectangle(302, 360, 0, 18, 0xf4bd4f).setOrigin(0, 0.5);
    const label = this.add
      .text(480, 322, "正在整理基地資料與戰鬥規格...", {
        color: "#17324d",
        fontFamily: "Arial",
        fontSize: "22px"
      })
      .setOrigin(0.5);

    this.load.on("progress", (value: number) => {
      progressBar.width = 356 * value;
    });

    this.load.on("complete", () => {
      progressBox.destroy();
      progressBar.destroy();
      label.destroy();
    });
  }

  create(): void {
    this.scene.start("BaseScene");
  }
}
