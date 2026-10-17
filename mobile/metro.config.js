const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "src");
const config = getDefaultConfig(__dirname);

config.watchFolders = [src, path.join(root, "web", "src", "lib"), path.join(root, "desktop", "src"), path.join(root, "assets", "reactions")];
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];

const deflate = path.join(__dirname, "src", "platform", "deflate.ts");
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "./deflate.ts" && context.originModulePath.startsWith(src + path.sep)) {
    return { type: "sourceFile", filePath: deflate };
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
