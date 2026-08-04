import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

// TVs antigas (Samsung Tizen 5.0, WebKit 537.36) NÃO entendem a sintaxe
// moderna de cor do Tailwind v3: rgb(30 41 59 / <alpha>) com espaço e barra.
// Confirmado no inspetor: CSS.supports('rgb(30 41 59 / 1)') = false, e um
// bg-red-700 computava transparente na TV. A forma com vírgula rgba(30,41,59,a)
// funciona (e a TV suporta var() dentro dela). Este plugin converte a saída
// do Tailwind pra forma com vírgula, deixando o UI colorido visível na TV.
const legacyColorNotation = () => ({
  postcssPlugin: "legacy-color-notation",
  Declaration(decl) {
    const v = decl.value;
    if (!v || (v.indexOf("rgb(") === -1 && v.indexOf("hsl(") === -1)) return;
    decl.value = v
      .replace(/rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([^)]+)\)/g, "rgba($1, $2, $3, $4)")
      .replace(/rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g, "rgb($1, $2, $3)")
      .replace(/hsl\(\s*([\d.]+)\s+([\d.]+%)\s+([\d.]+%)\s*\/\s*([^)]+)\)/g, "hsla($1, $2, $3, $4)")
      .replace(/hsl\(\s*([\d.]+)\s+([\d.]+%)\s+([\d.]+%)\s*\)/g, "hsl($1, $2, $3)");
  },
});
legacyColorNotation.postcss = true;

export default {
  plugins: [tailwindcss(), legacyColorNotation(), autoprefixer()],
};
