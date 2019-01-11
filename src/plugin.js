import getConfig, { svgoJSONFilePath } from "./getConfig";
import path from "@skpm/path";
import fs from "@skpm/fs";
import dialog from "@skpm/dialog";
import { spawnSync } from "@skpm/child_process";
import svgo from "svgo";
import svgoPlugins from "./svgo-plugins";
import svgtojsx from "svg-to-jsx";
import UI from "sketch/ui";

export function openSettings() {
  // Plugin was run from the menu, so let's open the settings window
  const response = dialog.showMessageBox({
    buttons: ["Cancel"],
    message: "About SVG to JSX",
    detail:
      "SVG to JSX Plugin exports the compressed SVG assets from Sketch to a ready-to-use .jsx file that contains each compressed SVG as functional components. \n\n "
  });
}

function formatName(str) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, function(letter, index) {
      return letter.toUpperCase();
    })
    .replace(/\s+/g, "");
}

export function compress(context) {
  const svgoJSON = getConfig();
  if (typeof svgoJSON.enabled !== "undefined" && !svgoJSON.enabled) {
    return;
  }

  const floatPrecision =
    typeof svgoJSON.floatPrecision !== "undefined"
      ? Number(svgoJSON.floatPrecision)
      : undefined;

  const parsedSVGOPlugins = [];
  svgoJSON.plugins.forEach(item => {
    if (typeof item.enabled !== "undefined" && !item.enabled) {
      return;
    }
    let plugin = svgoPlugins[item.name];
    if (item.path) {
      try {
        const loadedPlugin = coscript.require(
          path.join(
            String(MSPluginManager.mainPluginsFolderURL().path()),
            item.path
          )
        );

        // loadedPlugin is an NSDictionary so if we try to set something on it,
        // it will crash. Instead we move the values to a proper JS object.
        var keys = Object.keys(loadedPlugin);
        plugin = {};
        Object.keys(loadedPlugin).forEach(k => {
          plugin[k] = loadedPlugin[k];
        });
        if (loadedPlugin.params) {
          plugin.params = {};
          Object.keys(loadedPlugin.params).forEach(k => {
            plugin.params[k] = loadedPlugin.params[k];
          });
        }
      } catch (err) {
        log(err);
      }
    }
    if (!plugin) {
      log("Plugin not found: " + (item.name || item.path));
      return;
    }
    if (svgoJSON.debug) log("Enabled plugin: " + (item.name || item.path));
    plugin.pluginName = item.name;
    plugin.active = true;
    if (plugin.params) {
      // Plugin supports params

      // Set floatPrecision across all the plugins
      if (floatPrecision && "floatPrecision" in plugin.params) {
        plugin.params.floatPrecision = floatPrecision;
      }
      if (svgoJSON.debug)
        log("—› default params: " + JSON.stringify(plugin.params, null, 2));
    }
    if (item.params != null) {
      if (typeof plugin.params === "undefined") {
        plugin.params = {};
      }
      for (var attrname in item.params) {
        plugin.params[attrname] = item.params[attrname];
      }
      if (svgoJSON.debug)
        log("—› resulting params: " + JSON.stringify(plugin.params, null, 2));
    }
    parsedSVGOPlugins.push([plugin]);
  });

  var exports = context.actionContext.exports;
  var filesToCompress = [];
  for (var i = 0; i < exports.length; i++) {
    var currentExport = exports[i];
    if (currentExport.request.format() == "svg") {
      filesToCompress.push(currentExport.path);
    }
  }

  if (filesToCompress.length > 0) {
    if (svgoJSON.debug) log("Let‘s go…");
    let originalTotalSize = 0;
    let compressedTotalSize = 0;
    let output = "";
    let exportPath = "";
    if (typeof svgoJSON.full === "undefined") {
      svgoJSON.full = true;
    }
    if (typeof svgoJSON.multipass === "undefined") {
      svgoJSON.multipass = true;
    }
    if (typeof svgoJSON.pretty === "undefined") {
      svgoJSON.pretty = true;
    }
    if (typeof svgoJSON.indent === "undefined") {
      svgoJSON.indent = 2;
    }
    const svgCompressor = new svgo({
      full: svgoJSON.full,
      js2svg: {
        pretty: svgoJSON.pretty,
        indent: svgoJSON.indent
      },
      plugins: parsedSVGOPlugins,
      multipass: svgoJSON.multipass
    });
    const promiseList = filesToCompress.map(currentFile => {
      const svgString = fs.readFileSync(currentFile, "utf8");
      originalTotalSize += svgString.length;
      // Hacks for plugins
      svgCompressor.config.plugins.forEach(([plugin]) => {
        // cleanupIDs
        if (plugin.pluginName == "cleanupIDs") {
          const parts = currentFile.split("/");
          var prefix =
            parts[parts.length - 1]
              .replace(".svg", "")
              .replace(/\s+/g, "-")
              .toLowerCase() + "-";
          if (svgoJSON.debug) log("Setting cleanupIDs prefix to: " + prefix);
          plugin.params["prefix"] = prefix;
        }
      });

      return svgCompressor.optimize(svgString).then(result => {
        compressedTotalSize += result.data.length;
        svgtojsx(result.data, (error, jsx) => {
          // fs.writeFileSync(currentFile, jsx, "utf8");
          const splitName = currentFile.split("/");
          let [fileName] = splitName.splice(splitName.length - 1, 1);
          const path = splitName.join("/") + "/";
          if (!exportPath) {
            exportPath = path;
          }
          fileName = formatName(fileName.replace(".svg", ""));
          output = `
${output}
const ${fileName} = () => (
  ${jsx}
)`;
        });
      });
    });
    Promise.all(promiseList)
      .then(() => {
        fs.writeFileSync(exportPath + "index.jsx", output, "utf8");
        UI.message(`Successfully exported jsx components to ${exportPath}.jsx`);
      })
      .catch(err => {
        log(err);
        UI.message(err.message);
      });
  }
}
