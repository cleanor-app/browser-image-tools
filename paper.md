---
title: 'browser-image-tools: privacy-first, client-side image conversion and compression'
tags:
  - TypeScript
  - JavaScript
  - image compression
  - image conversion
  - WebAssembly
  - WebP
  - AVIF
  - privacy
authors:
  - name: Cleanor Labs
    orcid: 0009-0005-4623-961X
    affiliation: 1
affiliations:
  - name: Cleanor Research Labs
    index: 1
date: 6 July 2026
bibliography: paper.bib
---

# Summary

`browser-image-tools` is a framework-agnostic TypeScript library that converts,
compresses, resizes and encodes raster images entirely inside the web browser.
It reads PNG, JPEG, WebP, AVIF, GIF and BMP inputs and produces WebP, JPEG, PNG
and AVIF outputs using the browser's native Canvas encoder together with a
bundled WebAssembly AVIF codec [@jsquash]. Because every step runs on the
client, image bytes never leave the user's device: there is no server, upload,
or account. The library exposes a small, typed API organised into per-format
namespaces (`png`, `jpg`, `webp`, `avif`, `gif`, `ico`) plus shared canvas and
color utilities, and ships as both ES modules and CommonJS with full type
declarations. It is the image engine behind the production tools at
<https://cleanor.app/tools>.

# Statement of need

Image optimization is a routine but consequential task in web and application
development: modern formats such as WebP and AVIF are substantially smaller than
legacy JPEG at matched perceptual quality [@alakuijala2019jpegxl], directly
improving page-load performance and storage cost. Yet the common tooling forces
an unwelcome trade-off. Server-side optimizers (and the many "free online
converter" sites) require users to upload their images to a third party, which
is unacceptable for private, sensitive, or regulated content and adds latency
and operating cost. Client-only alternatives, when they exist, are typically
tied to a single codec or a specific UI framework and are not reusable as a
library.

`browser-image-tools` addresses this gap by packaging a complete, reusable,
on-device image pipeline. The same modules power a public suite of tools, so the
code is exercised at scale, but they are published independently so that any web
application — regardless of framework (React, Vue, Svelte, or none) — can embed
private image conversion and compression without operating an image backend.
Keeping the heavy WebAssembly codecs as optional, lazily-loaded dependencies
lets consumers pay their bundle cost only when a given format is used.

The library is intended for three audiences: (1) application developers who need
privacy-preserving, offline-capable image handling; (2) researchers and
educators who want a transparent, inspectable reference implementation of
browser-native encoding and perceptual comparison; and (3) maintainers of
privacy-focused or offline-first (PWA) products for whom "files never leave the
device" is a hard requirement.

# Functionality

The API is grouped by concern:

- **Decoding** uses `createImageBitmap`, which in current browsers accepts PNG,
  JPEG, WebP, AVIF, GIF and BMP, giving broad input coverage with no extra
  dependencies.
- **Encoding** to WebP, JPEG and PNG uses `HTMLCanvasElement.toBlob`, the
  browser's own encoders. JPEG output flattens transparency onto a white matte.
- **AVIF encoding**, which the Canvas API does not provide, is handled by a
  bundled single-thread `libavif`-based WebAssembly module [@jsquash], compiled
  and instantiated locally so it makes no network calls.
- **Analysis and utilities** include alpha/transparency analysis, dominant-color
  extraction, ICO assembly, convolution kernels, and file-size helpers.

The design follows the same measurement philosophy as the authors' companion
open datasets on image-format savings, which quantify the size-versus-quality
trade-offs using the structural similarity index [@wang2004ssim] against
lossless masters [@cleanorstoragelab].

# Acknowledgements

The AVIF encoder is provided by the jSquash project [@jsquash], which packages
the Alliance for Open Media `libavif` codec [@av1spec] for the browser. WebP is
developed by Google [@webp].

# References
