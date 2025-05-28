# @sanity/export

Exports documents and assets from a Sanity dataset

## Installing

```
npm install --save @sanity/export
```

## Usage

```js
const exportDataset = require('@sanity/export')

exportDataset({
  // Instance of @sanity/client configured to correct project ID and dataset
  client: someInstantiatedSanityClientInstance,

  // Name of dataset to export
  // Cannot be combined with `mediaLibraryId`.
  dataset: 'myDataset',

  // Path to write tar.gz-archive file to, or `-` for stdout
  outputPath: '/home/your-user/myDataset.tar.gz',

  // Whether or not to export assets. Note that this operation is currently slightly lossy;
  // metadata stored on the asset document itself (original filename, for instance) might be lost
  // Default: `true`
  assets: false,

  // Exports documents only, without downloading or rewriting asset references
  // Default: `false`
  raw: true,

  // Whether or not to export drafts
  // Default: `true`
  drafts: true,

  // Export only given document types (`_type`)
  // Optional, default: all types
  types: ['products', 'shops'],

  // Run 12 concurrent asset downloads
  assetConcurrency: 12,

  // What mode to use when exporting documents, can be eiter `stream`(default) or `cursor`.
  // Cursor mode might help when dealing with large datasets, but might yield inconsistent results if the dataset is mutated during export.
  // Default: 'stream'
  mode: 'stream',

  // Export data from a media library, instead of a dataset.
  // Cannot be combined with `dataset`.
  mediaLibraryId: 'myMediaLibrary',

  // Whether to include the `assets.json` assets map. This file is not necessary when creating a
  // media library archive.
  // Caution: customising this option may result in an archive being produced that is impossible to import.
  // Optional, default: `true`
  assetsMap: true,

  // A custom filter function for controlling which documents are exported.
  // Optional, default: `() => true`
  filterDocument: document => (document.title ?? '').includes('capybara'),

  // A custom transformation function for controlling how each document is exported.
  // Caution: customising this option may result in an archive being produced that is impossible to import.
  // Optional, default: `document => document`
  transformDocument: document => ({
    ...document,
    title: document.title ?? 'capybara',
  }),
})
```

## Future improvements

- Restore original filenames, keep track of duplicates, increase counter (`filename (<num>).ext`)
- Skip archiving on raw/no-asset mode?

## CLI-tool

This functionality is built in to the `@sanity/cli` package as `sanity dataset export`

## License

MIT-licensed. See LICENSE.
