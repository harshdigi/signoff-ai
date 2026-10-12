// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Api } from './index'

declare global {
  interface Window {
    api: Api
  }
}
