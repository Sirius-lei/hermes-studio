import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/models'

export const modelRoutes = new Router()

modelRoutes.get('/api/DiTing/available-models', ctrl.getAvailable)
modelRoutes.post('/api/DiTing/provider-models', ctrl.fetchProviderModelList)
modelRoutes.post('/api/DiTing/provider-models/cache/refresh', ctrl.refreshProviderModelCatalogCache)
modelRoutes.get('/api/DiTing/config/models', ctrl.getConfigModels)
modelRoutes.put('/api/DiTing/config/model', ctrl.setConfigModel)
modelRoutes.put('/api/DiTing/model-alias', ctrl.setModelAlias)
modelRoutes.put('/api/DiTing/model-visibility', ctrl.setModelVisibility)
modelRoutes.put('/api/DiTing/custom-model', ctrl.addCustomModel)
modelRoutes.delete('/api/DiTing/custom-model', ctrl.removeCustomModel)

// Model context routes
modelRoutes.get('/api/DiTing/model-context', ctrl.getModelContext)
modelRoutes.get('/api/DiTing/model-context/:provider/:model', ctrl.getModelContext)
modelRoutes.put('/api/DiTing/model-context/:provider/:model', ctrl.updateModelContext)
modelRoutes.put('/api/DiTing/model-context', ctrl.updateModelContext)
