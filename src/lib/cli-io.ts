export class CliIO {
  constructor(
    private readonly stdout: NodeJS.WritableStream,
    private readonly stderr: NodeJS.WritableStream,
  ) {}

  line(message: string): void {
    this.stdout.write(`${message}\n`);
  }

  error(message: string): void {
    this.stderr.write(`${message}\n`);
  }
}
