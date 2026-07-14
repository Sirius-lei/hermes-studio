import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/weixin'

export const weixinRoutes = new Router()

weixinRoutes.get('/api/DiTing/weixin/qrcode', ctrl.getQrcode)
weixinRoutes.get('/api/DiTing/weixin/qrcode/status', ctrl.pollStatus)
weixinRoutes.post('/api/DiTing/weixin/save', ctrl.save)
