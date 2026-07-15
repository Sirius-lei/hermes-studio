import Router from '@koa/router'
import * as ctrl from '../controllers/update'
import { requireSuperAdmin } from '../middleware/user-auth'

export const updateRoutes = new Router()

updateRoutes.post('/api/DiTing/update', ctrl.handleUpdate)
updateRoutes.get('/api/DiTing/update/preview', requireSuperAdmin, ctrl.previewStatus)
updateRoutes.get('/api/DiTing/update/preview/tags', requireSuperAdmin, ctrl.previewTags)
updateRoutes.post('/api/DiTing/update/preview/prepare', requireSuperAdmin, ctrl.preparePreview)
updateRoutes.post('/api/DiTing/update/preview/install', requireSuperAdmin, ctrl.installPreview)
updateRoutes.post('/api/DiTing/update/preview/start', requireSuperAdmin, ctrl.startPreview)
updateRoutes.post('/api/DiTing/update/preview/stop', requireSuperAdmin, ctrl.stopPreview)
