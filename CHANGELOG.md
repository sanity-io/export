<!-- markdownlint-disable --><!-- textlint-disable -->

# 📓 Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
