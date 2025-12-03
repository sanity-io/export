<!-- markdownlint-disable --><!-- textlint-disable -->

# 📓 Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [4.0.2](https://github.com/sanity-io/export/compare/v4.0.1...v4.0.2) (2025-12-03)

### Bug Fixes

- export releases together with drafts and versions ([1fcdfda](https://github.com/sanity-io/export/commit/1fcdfdaa3b6cb52716dce43d6efaefc59b3d1438))

## [4.0.1](https://github.com/sanity-io/export/compare/v4.0.0...v4.0.1) (2025-08-14)

### Bug Fixes

- allow v20 in node engines ([354001b](https://github.com/sanity-io/export/commit/354001b4fb94eae78941d513de1cfe0d5e382d44))

## [4.0.0](https://github.com/sanity-io/export/compare/v3.45.3...v4.0.0) (2025-08-12)

### ⚠ BREAKING CHANGES

- require node v20 or later

### Bug Fixes

- require node v20 or later ([2757f44](https://github.com/sanity-io/export/commit/2757f44c856c76baa5610e7fd291ff20041b6325))

## [3.45.3](https://github.com/sanity-io/export/compare/v3.45.2...v3.45.3) (2025-08-08)

### Bug Fixes

- allow `types` option, regardless of whether `dataset` option is provided ([#31](https://github.com/sanity-io/export/issues/31)) ([2f87281](https://github.com/sanity-io/export/commit/2f87281ec2bfcac77396664f65048f401690b7b6))

## [3.45.2](https://github.com/sanity-io/export/compare/v3.45.1...v3.45.2) (2025-06-27)

### Bug Fixes

- **types:** allow types on all the resource types ([4dea757](https://github.com/sanity-io/export/commit/4dea75727ced23404e91c17e129c238d562bc402))

## [3.45.1](https://github.com/sanity-io/export/compare/v3.45.0...v3.45.1) (2025-06-25)

### Bug Fixes

- **content-releases:** fix failing test that was missed due to test run bug where only one test was being run in CI ([7e6fefd](https://github.com/sanity-io/export/commit/7e6fefdc9f161150ba5cee7bbee59fb865bce696))
- **document-types:** use filter document types middleware to filter away document types on client side ([2199002](https://github.com/sanity-io/export/commit/219900212b3ebf21cfd918d1833eae09f30f60ba))
- remove erroneous test `only` modifier ([1f1a9a7](https://github.com/sanity-io/export/commit/1f1a9a7474c09dd040774d82a70ff67e66f46cad))

## [3.45.0](https://github.com/sanity-io/export/compare/v3.44.0...v3.45.0) (2025-06-17)

### Features

- **cli:** support exporting documents with specific types ([9e0095a](https://github.com/sanity-io/export/commit/9e0095ad9a5389d2fb048c984e50d12f0fb84583))

### Bug Fixes

- **getDocumentsStream:** use URL object to build url and add unit tests ([8568fd7](https://github.com/sanity-io/export/commit/8568fd798f3269976aeab7ff436f2783b43c5a5e))
- **url:** remove redundant usage of comma to join url search params ([f48fcb7](https://github.com/sanity-io/export/commit/f48fcb7c0f931febb1ed9d0c524e0adf1572bd18))

## [3.44.0](https://github.com/sanity-io/export/compare/v3.43.0...v3.44.0) (2025-05-12)

### Features

- update export for releases ([b6ff6f1](https://github.com/sanity-io/export/commit/b6ff6f17a528e877c4137a22b164f95909833c94))

## [3.43.0](https://github.com/sanity-io/export/compare/v3.42.2...v3.43.0) (2025-05-02)

### Features

- add `filterDocument` option ([ed235a2](https://github.com/sanity-io/export/commit/ed235a27e573797475cf0bed44f36199cf1d5b3b))
- add `transformDocument` option ([da37cd4](https://github.com/sanity-io/export/commit/da37cd447383408690ed68732b7a99e8d3bee2fa))
- add Media Library support ([4c581bc](https://github.com/sanity-io/export/commit/4c581bcfc24913ace0b829a291ad96cf3e0d10d6))
- make assets map optional ([a2e00a8](https://github.com/sanity-io/export/commit/a2e00a8a24c0f2fcdae5cf2a16c863bf7c179ae1))

## [3.42.2](https://github.com/sanity-io/export/compare/v3.42.1...v3.42.2) (2025-01-03)

### Bug Fixes

- retain falsy string and int array elements during export ([#20](https://github.com/sanity-io/export/issues/20)) ([ffb04f2](https://github.com/sanity-io/export/commit/ffb04f244c65abdcc2b8f40d2d7a22ee5151c0a0))

## [3.42.1](https://github.com/sanity-io/export/compare/v3.42.0...v3.42.1) (2025-01-02)

### Bug Fixes

- bump `@sanity/util` ([0069bc3](https://github.com/sanity-io/export/commit/0069bc30b04bb7fc47f44fed36a3f0b52c179d03))

## [3.42.0](https://github.com/sanity-io/export/compare/v3.41.2...v3.42.0) (2024-12-19)

### Features

- also ignore 401 and 403 when downloading assets. ([8f5df3d](https://github.com/sanity-io/export/commit/8f5df3d6684121b0389e078a92385e5287c43456))
- debug logging of archiver events. ([f226bea](https://github.com/sanity-io/export/commit/f226bea73da9661b56a1a3db40ba14d2daee10c5))
- ignore 404 errors when downloading assets. ([5f2790c](https://github.com/sanity-io/export/commit/5f2790c9c80b23150ff55044fd8b9d030e0f144c))

## [3.41.2](https://github.com/sanity-io/export/compare/v3.41.1...v3.41.2) (2024-12-19)

### Bug Fixes

- fixes stringifying of large asset maps by streaming the JSON to file. ([f8e24c9](https://github.com/sanity-io/export/commit/f8e24c92811abc9dfcc1c40c6a2e3f5a5e3e3122))

## [3.41.1](https://github.com/sanity-io/export/compare/v3.41.0...v3.41.1) (2024-12-11)

### Bug Fixes

- **deps:** upgrade rimraf to latest ([#17](https://github.com/sanity-io/export/issues/17)) ([6b3cfea](https://github.com/sanity-io/export/commit/6b3cfea6c77f334eb212f4f5e5d03c697b07061b))

## [3.41.0](https://github.com/sanity-io/export/compare/v3.40.0...v3.41.0) (2024-07-22)

### Features

- add more debug logs to cursor stream ([c4ab854](https://github.com/sanity-io/export/commit/c4ab8549cb24380833729d4d241d4b1ef274fb76))
- add status code logging to export with cursor ([0d1f341](https://github.com/sanity-io/export/commit/0d1f341fbf0dceed58b2f5bfc2a4e7f377cff07f))

### Bug Fixes

- **cursor:** dont parse empty strings ([dd20c28](https://github.com/sanity-io/export/commit/dd20c288b779d94d1a83af6e8c71fb079a18c5df))
- handle multiple json docs inside one chunk when streaming with cursor ([b17e562](https://github.com/sanity-io/export/commit/b17e562462fcaef564503c64af54d26976a8d056))
- log failed chunk ([11e78c7](https://github.com/sanity-io/export/commit/11e78c77586ec3bb0fbdf19a9e256071b0803449))

## [3.40.0](https://github.com/sanity-io/export/compare/v3.39.0...v3.40.0) (2024-07-02)

### Features

- add support for exporting documents with "inconsistent" cursor ([4294be0](https://github.com/sanity-io/export/commit/4294be063b00b037186d47f18898dbe7cba1cd78))

## [3.39.0](https://github.com/sanity-io/export/compare/v3.38.2...v3.39.0) (2024-06-24)

### Features

- add option for tweaking readTimeout ([03db723](https://github.com/sanity-io/export/commit/03db72362914298834780c083412dfdd5f9ea484))

## [3.38.2](https://github.com/sanity-io/export/compare/v3.38.1...v3.38.2) (2024-06-21)

### Bug Fixes

- check for document attributes to prevent throwing on error like document ([d7ffa00](https://github.com/sanity-io/export/commit/d7ffa0014319d6edb01f5d2e63dde3ec634c0999))

## [3.38.1](https://github.com/sanity-io/export/compare/v3.38.0...v3.38.1) (2024-05-22)

### Bug Fixes

- stream documents to tmp file ([#8](https://github.com/sanity-io/export/issues/8)) ([2fed7bb](https://github.com/sanity-io/export/commit/2fed7bbe9973deadc49a741822c11ebf81079d38)), closes [/github.com/archiverjs/node-archiver/blob/master/lib/plugins/tar.js#L79-L90](https://github.com/sanity-io//github.com/archiverjs/node-archiver/blob/master/lib/plugins/tar.js/issues/L79-L90) [/github.com/archiverjs/archiver-utils/blob/master/index.js#L21-L43](https://github.com/sanity-io//github.com/archiverjs/archiver-utils/blob/master/index.js/issues/L21-L43)

## [3.38.0](https://github.com/sanity-io/export/compare/v3.37.4...v3.38.0) (2024-05-08)

### Features

- make max retries configurable ([e02fa3a](https://github.com/sanity-io/export/commit/e02fa3ad459647d467a2cd1663a03f15b2248952))
- resolve with result object ([9ba6d27](https://github.com/sanity-io/export/commit/9ba6d27b95f0575ec9cdb79d20fa4cd5eac5ef68))

### Bug Fixes

- **asset-handler:** do not clear pending task queue on a transient failure, today this is causing missing assets in final export when a transient failure is encountered ([593e496](https://github.com/sanity-io/export/commit/593e49638404b096660e1f8f4476cd1302c8dd95))
- catch errors during entire lifecycle ([e981a92](https://github.com/sanity-io/export/commit/e981a927fbe6914e02157e2612bb864ed572121b))
- correct error message for asset stream errors ([927c958](https://github.com/sanity-io/export/commit/927c958444a7aef2166a15c4b75b024b39626844))
- do not retry client errors on asset downloading ([6e8cd12](https://github.com/sanity-io/export/commit/6e8cd12f00cfc8f255a5dc75d38cc4876ce40eed))
- **export:** remove promise rejection handling since we are handling it in pipeline ([9b49a32](https://github.com/sanity-io/export/commit/9b49a32f4e4a32e62434ba9a31dc2a7019fe839f))
- **export:** throw when export pipeline encounters an error, today it is silently failing and hanging if any of the pipeline step fails ([173a672](https://github.com/sanity-io/export/commit/173a67282fc496e5ad77a1cf2beec1e3ea48ae20))
- improve error messages from API errors ([3b601fe](https://github.com/sanity-io/export/commit/3b601fed718f6ad74474fa1533c98919a2b32713))
- improve error messages from request errors ([6aeeb9e](https://github.com/sanity-io/export/commit/6aeeb9e5d0556213d0387e5d8ffd289e56af247b))
- improved debug message on errors ([253229e](https://github.com/sanity-io/export/commit/253229eb131513e981324057744d855aed57f690))
- **tests:** remove dependancy on canvas to create images and depend on static image ([1ba1a36](https://github.com/sanity-io/export/commit/1ba1a3613c2aa40b2f41d1ff0e7c82847bd33adf))
- validate number flags ([878b945](https://github.com/sanity-io/export/commit/878b9453fb87da776f7b9c4e92bd5e0766d7c765))

## [3.37.4](https://github.com/sanity-io/export/compare/v3.37.3...v3.37.4) (2024-04-23)

### Bug Fixes

- relay error messages for better visibility ([#1](https://github.com/sanity-io/export/issues/1)) ([fdac3ab](https://github.com/sanity-io/export/commit/fdac3ab53d75c21fdbf54582d4616b50bf68955a))
