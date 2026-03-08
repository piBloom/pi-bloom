declare module "qrcode-terminal" {
	function generate(text: string, opts?: { small?: boolean }): void;
	export default { generate };
}
