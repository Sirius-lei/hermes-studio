import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/mcu-firmware'

export const mcuFirmwareRoutes = new Router()

mcuFirmwareRoutes.get('/api/DiTing/mcu/firmware/manifest', ctrl.manifest)
mcuFirmwareRoutes.get('/api/DiTing/mcu/firmware.bin', ctrl.download)
