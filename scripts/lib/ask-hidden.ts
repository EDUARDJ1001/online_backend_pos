import readline from "readline";

/**
 * Pide un texto en la consola sin mostrarlo: cada carácter se ve como "*".
 * Admite borrar (Retroceso), pegar y Ctrl + C para cancelar. Sin consola interactiva
 * (entrada redirigida), lee las líneas tal cual.
 */

let pipedLines: string[] | null = null;
let pipedReady: Promise<void> | null = null;

function readPipedLines() {
  pipedReady ??= new Promise<void>((resolve) => {
    pipedLines = [];
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => pipedLines!.push(line));
    rl.on("close", () => resolve());
  });
  return pipedReady;
}

export async function askHidden(question: string): Promise<string> {
  const input = process.stdin;

  if (!input.isTTY) {
    process.stdout.write(question);
    await readPipedLines();
    process.stdout.write("\n");
    return pipedLines!.shift() ?? "";
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";
    process.stdout.write(question);

    const finish = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          finish();
          reject(new Error("Cancelado. No se cambió nada."));
          return;
        }
        if (char === "\u0008" || char === "\u007f") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (char >= " ") {
          value += char;
          process.stdout.write("*");
        }
      }
    };

    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    input.on("data", onData);
  });
}
