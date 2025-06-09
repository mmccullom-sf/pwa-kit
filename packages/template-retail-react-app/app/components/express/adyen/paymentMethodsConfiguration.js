import {applePayConfig} from './applePayConfig'

export const paymentMethodsConfiguration = ({
    paymentMethods = [],
    additionalPaymentMethodsConfiguration,
    ...props
}) => {
    const defaultConfig = baseConfig(props)
    if (!paymentMethods || !paymentMethods.length) {
        return defaultConfig
    }

    const paymentMethodsConfig = {
        applepay: applePayConfig(props)
    }

    return Object.fromEntries(
        paymentMethods.map((paymentMethod) => {
            const type = paymentMethod.type === 'scheme' ? 'card' : paymentMethod.type
            const basePaymentMethodConfig = Object.hasOwn(paymentMethodsConfig, type)
                ? paymentMethodsConfig[type]
                : defaultConfig
            return additionalPaymentMethodsConfiguration?.[type]
                ? [
                      type,
                      {...basePaymentMethodConfig, ...additionalPaymentMethodsConfiguration[type]}
                  ]
                : [type, basePaymentMethodConfig]
        })
    )
}
