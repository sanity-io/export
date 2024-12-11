<!-- markdownlint-disable --><!-- textlint-disable -->

# 📓 Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
