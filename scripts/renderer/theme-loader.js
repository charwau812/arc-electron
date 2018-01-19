const fs = require('fs-extra');
const electron = require('electron');
const path = require('path');
const app = (electron.app || electron.remote.app);
const {ArcPreferences} = require('../main/arc-preferences');

class ThemeLoader {
  constructor() {
    this.basePath = path.join(app.getPath('userData'), 'themes');
    this.infoFilePath = path.join(this.basePath, 'themes-info.json');
    this.listThemesHandler = this.listThemesHandler.bind(this);
    this.activeThemeHandler = this.activeThemeHandler.bind(this);
    this.activateHandler = this.activateHandler.bind(this);
    this.editCurrentHandler = this.editCurrentHandler.bind(this);
    this.defaultTheme = 'dd1b715f-af00-4ee8-8b0c-2a262b3cf0c8';
    this.activeTheme = undefined;
  }

  listen() {
    window.addEventListener('themes-list', this.listThemesHandler);
    window.addEventListener('theme-active-info', this.activeThemeHandler);
    window.addEventListener('theme-activate', this.activateHandler);
    window.addEventListener('theme-editor-edit', this.editCurrentHandler);
  }
  /**
   * Handler for the `themes-list` custom event from theme panel.
   */
  listThemesHandler(e) {
    e.preventDefault();
    e.detail.result = this.loadThemes();
  }
  /**
   * Handler for the `theme-active-info` custom event from theme panel.
   */
  activeThemeHandler(e) {
    const prefs = new ArcPreferences(this.settingsFile);
    e.preventDefault();
    if (this.activeTheme) {
      e.detail.result = Promise.resolve(this.activeTheme);
      return;
    }
    e.detail.result = prefs.loadSettings()
    .then(config => {
      var theme;
      if (config && config.theme) {
        theme = config.theme;
      }
      if (!theme) {
        theme = this.defaultTheme;
      }
      this.activeTheme = theme;
      return theme;
    });
  }
  /**
   * Activates a theme selected by the user.
   */
  activateHandler(e) {
    const id = e.detail.theme;
    return this.activateTheme(id)
    .then(() => this.updateThemeSettings(id));
  }
  /**
   * Activates theme for given ID.
   * IDs are generated upon theme installation and stored in `this.basePath`
   * in `themes-info.json` file. This function reads the file to find
   * the theme.
   *
   * @param {[type]} id [description]
   * @return {[type]} [description]
   */
  activateTheme(id) {
    var model;
    var themes;
    this.removeCustomStyle();
    this.activeTheme = id;
    return this.loadThemes()
    .then(data => {
      themes = data;
      return this.getThemeInfo(id, data);
    })
    .then(info => {
      if (!info) {
        console.error('Theme not found. Going back to the default theme.');
        this.activeTheme = this.defaultTheme;
        info = this.getThemeInfo(this.defaultTheme, themes);
      }
      return info;
    })
    .then(info => this._fillThemeInfo(info))
    .then(info => {
      model = info;
      return info;
    })
    .then(info => this._loadWebComponent(info.fileLocation))
    .then(() => this.includeCustomStyle(model.themeName));
  }
  /**
   * Removes pre-existing custom style module with theme definition.
   * It also uses Polymer's low level API to clear variables and mixins.
   */
  removeCustomStyle() {
    var old = document.body.querySelector('[data-theme]');
    if (!old) {
      return;
    }
    var cached = Polymer.StyleDefaults._styles;
    if (!cached) {
      return;
    }
    var theme = old.dataset.theme;
    for (var i = cached.length - 1; i >= 0; i--) {
      let item = cached[i];
      if (item.dataset.theme !== theme) {
        continue;
      }
      let removed = Polymer.StyleDefaults._styles.splice(i, 1)[0];
      try {
        removed.parentNode.removeChild(removed);
      } catch (e) {}
    }
    Polymer.StyleDefaults._properties = undefined;
  }
  /**
   * Creates a custom style module that includes theme definition.
   *
   * @param {String} themeName Loaded theme module name to include in the styles.
   */
  includeCustomStyle(themeName) {
    var s = document.createElement('style', 'custom-style');
    s.include = themeName;
    s.dataset.theme = themeName;
    document.body.appendChild(s);
    Polymer.updateStyles();
  }
  /**
   * Finds a theme by its ID in themes array.
   *
   * @param {String} id Generated theme ID
   * @param {Array} themes List og themes objects
   * @return {Object} Theme model.
   */
  getThemeInfo(id, themes) {
    themes = themes || [];
    return themes.find(item => item._id === id);
  }
  /**
   * Adds required by this program fields to the Theme info model.
   *
   * @param {Object} info Theme model object
   * @return {Object} Updated theme model.
   */
  _fillThemeInfo(info) {
    var name = 'arc-theme-';
    name += info.main.replace('.html', '');
    info.themeName  = name;
    info.fileLocation = path.join(info.path, info.main);
    return info;
  }

  /**
   * Updates settings file location so next check for theme configuration will
   * be made to correct configuration file.
   */
  setupSettingsFile(path) {
    this.settingsFile = path;
  }

  /**
   * Loads list of themes from apps directory.
   */
  loadThemes() {
    return fs.readJson(this.infoFilePath, {throws: false})
    .then(info => {
      if (!info) {
        info = [];
      }
      return info;
    });
  }
  /**
   * Updates theme preferences in the settings file.
   *
   * @param {String} themeId Preferred theme ID
   * @return {Promise} Resolved promise when settings file is saved.
   */
  updateThemeSettings(themeId) {
    const prefs = new ArcPreferences(this.settingsFile);
    return prefs.loadSettings()
    .then(() => prefs.saveConfig('theme', themeId));
  }
  /**
   * A handler for edit current theme action.
   * Opens a theme editor for currently loaded theme.
   */
  editCurrentHandler() {
    if (!this.activeTheme) {
      console.error('Theme is not activated.');
      return;
    }
    var themeInfo;
    return this.loadThemes()
    .then(data => this.getThemeInfo(this.activeTheme, data))
    .then(theme => {
      if (!theme) {
        throw new Error('Theme not found.');
      }
      return this._fillThemeInfo(theme);
    })
    .then(theme => {
      themeInfo = theme;
      return this._analyzeStyles();
    })
    .then(styleData => {
      require('electron').ipcRenderer.send('open-theme-editor', {
        themeId: this.activeTheme,
        themesLocation: this.basePath,
        theme: themeInfo,
        styles: styleData
      });
    })
    .catch(cause => {
      console.error('Unable to start theme editor', cause);
    });
  }

  _analyzeStyles() {
    const cacheFile = path.join(this.basePath, '.cache', 'style-' + this.activeTheme + '.json');
    return fs.pathExists(cacheFile)
    .then(exists => {
      if (exists) {
        return fs.readJson(cacheFile);
      }
      return this._loadAnalyzer()
      .then(analyzer => analyzer.analyze())
      .then(result => {
        return this._storeStylesCache(cacheFile, result).then(() => result);
      });
    });
  }

  _storeStylesCache(cacheFile, data) {
    var dir = path.dirname(cacheFile);
    return fs.ensureDir(dir)
    .then(() => fs.writeJson(cacheFile, data));
  }

  _loadAnalyzer() {
    var analyzer = document.getElementById('styleAnalyzer');
    if (analyzer) {
      return Promise.resolve(analyzer);
    }
    let loc = 'bower_components/polymer-styles-analyzer/polymer-styles-analyzer.html';
    return this._loadWebComponent(loc)
    .then(() => {
      let analyzer = document.createElement('polymer-styles-analyzer');
      analyzer.id = 'styleAnalyzer';
      analyzer.skipLayoutVariables = true;
      document.body.appendChild(analyzer);
      return analyzer;
    });
  }

  _loadWebComponent(file) {
    return new Promise((resolve, reject) => {
      Polymer.Base.importHref(file, () => {
        resolve();
      }, () => {
        reject(new Error('Unable to load file', file));
      });
    });
  }
}
exports.ThemeLoader = ThemeLoader;
