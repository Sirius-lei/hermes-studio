import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/config'

export const configRoutes = new Router()

configRoutes.get('/api/DiTing/config', ctrl.getConfig)
configRoutes.put('/api/DiTing/config', ctrl.updateConfig)
configRoutes.get('/api/DiTing/config/auxiliary-models', ctrl.getAuxiliaryModels)
configRoutes.put('/api/DiTing/config/auxiliary-models', ctrl.updateAuxiliaryModels)
configRoutes.put('/api/DiTing/config/credentials', ctrl.updateCredentials)
