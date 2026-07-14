import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/plugins'

export const pluginRoutes = new Router()

pluginRoutes.get('/api/DiTing/plugins', ctrl.list)
