import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/providers'

export const providerRoutes = new Router()

providerRoutes.post('/api/DiTing/config/providers', ctrl.create)
providerRoutes.put('/api/DiTing/config/providers/:poolKey', ctrl.update)
providerRoutes.delete('/api/DiTing/config/providers/:poolKey', ctrl.remove)
