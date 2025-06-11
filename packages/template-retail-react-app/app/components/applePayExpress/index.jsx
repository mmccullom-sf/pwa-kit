/*
 * Copyright (c) 2025, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import React, {useEffect, useRef} from 'react'
import AdyenCheckout from '@adyen/adyen-web'
import '@adyen/adyen-web/dist/adyen.css'
import {Spinner, Flex} from '@chakra-ui/react'
import PropTypes from 'prop-types'
import {useAdyenExpressCheckout} from '@adyen/adyen-salesforce-pwa'
import {getCurrencyValueForApi} from './utils/parsers.mjs'
import {AdyenShippingMethodsService} from './utils/shipping-methods'
import {AdyenShippingAddressService} from './utils/shipping-address'
import {AdyenPaymentsService} from './utils/payments'

const PAYMENT_METHOD = 'applepay';
const EXPRESS_PAYMENT_AVAILABLE = 'express.payment.available';
const EXPRESS_PAYMENT_UNAVAILABLE = 'express.payment.unavailable';
const EXPRESS_PAYMENT_SUCCESS = 'express.payment.success';
const EXPRESS_PAYMENT_FAILURE = 'express.payment.failure';
const EXPRESS_PAYMENT_CANCEL = 'express.payment.cancel';

const sendExpressMessage = (type, payload = {}) => {
    window.parent.postMessage(
        {
            type,
            payload
        },
        '*'
    );
};

export const getApplePaymentMethodConfig = (paymentMethodsResponse) => {
    const applePayPaymentMethod = paymentMethodsResponse?.paymentMethods?.find(
        (pm) => pm.type === PAYMENT_METHOD
    )
    return applePayPaymentMethod?.configuration || null
}

export const getCustomerShippingDetails = (shippingContact) => {
    return {
        deliveryAddress: {
            city: shippingContact.locality,
            country: shippingContact.countryCode,
            houseNumberOrName:
                shippingContact.addressLines?.length > 1 ? shippingContact.addressLines[1] : '',
            postalCode: shippingContact.postalCode,
            stateOrProvince: shippingContact.administrativeArea,
            street: shippingContact.addressLines?.[0]
        },
        profile: {
            firstName: shippingContact.givenName,
            lastName: shippingContact.familyName,
            email: shippingContact.emailAddress,
            phone: shippingContact.phoneNumber
        }
    }
}

export const getCustomerBillingDetails = (billingContact) => {
    return {
        billingAddress: {
            city: billingContact.locality,
            country: billingContact.countryCode,
            houseNumberOrName:
                billingContact?.addressLines?.length > 1 ? billingContact.addressLines[1] : '',
            postalCode: billingContact.postalCode,
            stateOrProvince: billingContact.administrativeArea,
            street: billingContact.addressLines?.[0]
        }
    }
}

export const getAppleButtonConfig = (
    authToken,
    site,
    basket,
    shippingMethods,
    applePayConfig,
    navigate,
    fetchShippingMethods
) => {
    let applePayAmount = basket.orderTotal
    const buttonConfig = {
        showPayButton: true,
        isExpress: true,
        configuration: applePayConfig,
        amount: {
            value: getCurrencyValueForApi(basket.orderTotal, basket.currency),
            currency: basket.currency
        },
        requiredShippingContactFields: ['postalAddress', 'name', 'email', 'phone'],
        requiredBillingContactFields: ['postalAddress'],
        shippingMethods: shippingMethods?.map((sm) => ({
            label: sm.name,
            detail: sm.description,
            identifier: sm.id,
            amount: `${sm.price}`
        })),
        onAuthorized: async (resolve, reject, event) => {
            try {
                const {shippingContact, billingContact, token} = event.payment
                const state = {
                    data: {
                        paymentType: 'express',
                        paymentMethod: {
                            type: 'applepay',
                            applePayToken: token.paymentData
                        },
                        ...getCustomerBillingDetails(billingContact),
                        ...getCustomerShippingDetails(shippingContact)
                    }
                }
                const adyenPaymentService = new AdyenPaymentsService(authToken, site)
                const paymentsResponse = await adyenPaymentService.submitPayment(
                    {
                        ...state.data,
                        origin: state.data.origin ? state.data.origin : window.location.origin
                    },
                    basket?.basketId,
                    basket?.customerInfo?.customerId
                )
                if (paymentsResponse?.isFinal && paymentsResponse?.isSuccessful) {
                    const finalPriceUpdate = {
                        newTotal: {
                            type: 'final',
                            label: applePayConfig.merchantName,
                            amount: `${applePayAmount}`
                        }
                    }
                    resolve(finalPriceUpdate)

                    var orderId = paymentsResponse?.merchantReference;

                    sendExpressMessage(EXPRESS_PAYMENT_SUCCESS, {
                        orderId,
                        PAYMENT_METHOD
                    });
                } else {
                    reject()
                    sendExpressMessage(EXPRESS_PAYMENT_FAILURE, {
                        PAYMENT_METHOD
                    });
                }
            } catch (err) {
                reject()
                sendExpressMessage(EXPRESS_PAYMENT_FAILURE, {
                    PAYMENT_METHOD
                });
            }
        },
        onSubmit: () => {},
        onShippingContactSelected: async (resolve, reject, event) => {
            try {
                const {shippingContact} = event
                const adyenShippingAddressService = new AdyenShippingAddressService(authToken, site)
                const adyenShippingMethodsService = new AdyenShippingMethodsService(authToken, site)
                const customerShippingDetails = getCustomerShippingDetails(shippingContact)
                await adyenShippingAddressService.updateShippingAddress(
                    basket.basketId,
                    customerShippingDetails
                )
                const newShippingMethods = await fetchShippingMethods(
                    basket?.basketId,
                    site,
                    authToken
                )
                if (!newShippingMethods?.applicableShippingMethods?.length) {
                    reject()
                } else {
                    const response = await adyenShippingMethodsService.updateShippingMethod(
                        newShippingMethods.applicableShippingMethods[0].id,
                        basket.basketId
                    )
                    buttonConfig.amount = {
                        value: getCurrencyValueForApi(response.orderTotal, response.currency),
                        currency: response.currency
                    }
                    applePayAmount = response.orderTotal
                    const finalPriceUpdate = {
                        newShippingMethods: newShippingMethods?.applicableShippingMethods?.map(
                            (sm) => ({
                                label: sm.name,
                                detail: sm.description,
                                identifier: sm.id,
                                amount: `${sm.price}`
                            })
                        ),
                        newTotal: {
                            type: 'final',
                            label: applePayConfig.merchantName,
                            amount: `${applePayAmount}`
                        }
                    }
                    resolve(finalPriceUpdate)
                }
            } catch (err) {
                reject()
            }
        },
        onShippingMethodSelected: async (resolve, reject, event) => {
            try {
                const {shippingMethod} = event
                const adyenShippingMethodsService = new AdyenShippingMethodsService(authToken, site)
                const response = await adyenShippingMethodsService.updateShippingMethod(
                    shippingMethod.identifier,
                    basket.basketId
                )
                if (response.error) {
                    reject()
                } else {
                    buttonConfig.amount = {
                        value: getCurrencyValueForApi(response.orderTotal, response.currency),
                        currency: response.currency
                    }
                    applePayAmount = response.orderTotal
                    const applePayShippingMethodUpdate = {
                        newTotal: {
                            type: 'final',
                            label: applePayConfig.merchantName,
                            amount: `${applePayAmount}`
                        }
                    }
                    resolve(applePayShippingMethodUpdate)
                }
            } catch (err) {
                reject()
            }
        },
        onError: (error, component) => {
            console.error(error.name, error.message, error.stack, component);
            if (error.name === 'CANCEL') {
                sendExpressMessage(EXPRESS_PAYMENT_CANCEL, {
                    PAYMENT_METHOD
                });
            } else {
                sendExpressMessage(EXPRESS_PAYMENT_FAILURE, {
                    PAYMENT_METHOD
                });
            }
        }
    }
    return buttonConfig
}

export const ApplePayExpress = (props) => {
    const {
        adyenEnvironment,
        adyenPaymentMethods,
        basket,
        locale,
        site,
        authToken,
        navigate,
        shippingMethods,
        fetchShippingMethods
    } = useAdyenExpressCheckout()
    const paymentContainer = useRef(null)

    useEffect(() => {
        const instanceId = Math.random().toString(36).substr(2, 9);
        console.log(`🚀 STARTING INSTANCE: ${instanceId}`);

        console.log('✅ After instanceId creation');

        let isCancelled = false;
        console.log('✅ After isCancelled initialization');

        console.log('✅ About to define createCheckout function');
        const createCheckout = async () => {
            if (isCancelled) {
                console.log(`🚫 Instance ${instanceId}: Cancelled before starting`);
                return;
            }
            try {
                console.log(`📍 Instance ${instanceId}: Inside createCheckout`);
                const withTimeout = (promise, timeoutMs, errorMessage) => {
                    console.log(`Setting timeout for ${timeoutMs}ms: ${errorMessage}`);

                    const timeoutPromise = new Promise((_, reject) => {
                        const timeoutId = setTimeout(() => {
                            if (isCancelled) {
                                console.log(`🚫 Instance ${instanceId}: Timeout cancelled for ${errorMessage}`);
                                return;
                            }
                            console.log(`TIMEOUT TRIGGERED: ${errorMessage}`);
                            console.log(`About to reject promise for: ${errorMessage}`);
                            reject(new Error(errorMessage));
                            console.log(`Promise rejected for: ${errorMessage}`);
                        }, timeoutMs);

                        console.log(`Timeout ID: ${timeoutId} set for ${timeoutMs}ms`);
                    });

                    console.log(`About to wrap promise for: ${errorMessage}`);
                    const wrappedPromise = Promise.resolve(promise)
                        .then(result => {
                            console.log(`PROMISE RESOLVED: ${errorMessage} - Result:`, result);
                            return result;
                        })
                        .catch(error => {
                            console.log(`PROMISE REJECTED: ${errorMessage} - Error:`, error.message);
                            throw error;
                        });

                    console.log(`Wrapped promise created for: ${errorMessage}`);

                                        console.log('Starting Promise.race...');
                    console.log('wrappedPromise:', wrappedPromise);
                    console.log('timeoutPromise:', timeoutPromise);

                    const racePromise = Promise.race([wrappedPromise, timeoutPromise]);
                    console.log(`Promise.race created for: ${errorMessage}`, racePromise);

                    const handledRacePromise = racePromise
                        .then(result => {
                            console.log(`RACE WON BY PROMISE: ${errorMessage} - Result:`, result);
                            return result;
                        })
                        .catch(error => {
                            console.log(`RACE WON BY TIMEOUT: ${errorMessage} - Error:`, error.message);
                            console.log(`About to re-throw error for: ${errorMessage}`);
                            throw error;
                        });

                    console.log('Returning handled race promise for:', errorMessage);
                    return handledRacePromise;
                };

                const handleApplePayUnavailable = () => {
                    console.log('*****UNAVAILABLE******');
                    sendExpressMessage(EXPRESS_PAYMENT_UNAVAILABLE, {
                        PAYMENT_METHOD
                    });
                };

                console.log('Starting Adyen Checkout...');
                var checkout;
                try {
                    console.log('About to call withTimeout for Adyen Checkout...');
                    checkout = await withTimeout(
                        AdyenCheckout({
                            environment: adyenEnvironment?.ADYEN_ENVIRONMENT,
                            clientKey: adyenEnvironment?.ADYEN_CLIENT_KEY,
                            locale: locale.id,
                            analytics: {
                                analyticsData: {
                                    applicationInfo: adyenPaymentMethods?.applicationInfo
                                }
                            }
                        }),
                        1000,
                        'Adyen Checkout timed out'
                    )
                    console.log('withTimeout completed for Adyen Checkout');
                } catch (ex) {
                    console.log('🎯 CAUGHT ERROR in outer try-catch!');
                    console.error(`❌ Instance ${instanceId}: Adyen Checkout failed or timed out:`, ex.message);
                    handleApplePayUnavailable();
                    console.log(`🛑 Instance ${instanceId}: RETURNING after Adyen Checkout failure`);
                    return;
                }

                const applePaymentMethodConfig = getApplePaymentMethodConfig(adyenPaymentMethods)
                const appleButtonConfig = getAppleButtonConfig(
                    authToken,
                    site,
                    basket,
                    shippingMethods?.applicableShippingMethods,
                    applePaymentMethodConfig,
                    navigate,
                    fetchShippingMethods
                )

                console.log('Creating ApplePay button...');
                var applePayButton;
                try {
                    applePayButton = await withTimeout(
                        checkout.create('applepay', appleButtonConfig),
                        1000,
                        'ApplePay button creation timed out'
                    );
                } catch (ex) {
                    console.error(`❌ Instance ${instanceId}: ApplePay button creation failed or timed out:`, ex.message);
                    handleApplePayUnavailable();
                    console.log(`🛑 Instance ${instanceId}: RETURNING after ApplePay button creation failure`);
                    return;
                }

                console.log('Starting Apple Pay availability check...');
                var isApplePayButtonAvailable = false;
                try {
                    isApplePayButtonAvailable = await withTimeout(
                        applePayButton.isAvailable(),
                        1000,
                        'Apple Pay isAvailable check timed out'
                    );
                    console.log('Apple Pay availability result:', isApplePayButtonAvailable);
                } catch (ex) {
                    console.error('Apple Pay availability check failed or timed out:', ex.message);
                    console.log('About to call handleApplePayUnavailable from availability check...');
                }

                if (!isApplePayButtonAvailable) {
                    handleApplePayUnavailable();
                    return;
                }

                console.log('Starting Apple Pay mount...');
                try {
                    await withTimeout(
                        applePayButton.mount(paymentContainer.current),
                        1000,
                        'Apple Pay mount timed out'
                    );

                    console.log('Apple Pay mount successful!');
                    sendExpressMessage(EXPRESS_PAYMENT_AVAILABLE, {
                        PAYMENT_METHOD
                    });
                } catch (error) {
                    console.error('Apple Pay mount failed or timed out:', error.message);
                    console.log('About to call handleApplePayUnavailable from mount...');
                    handleApplePayUnavailable();
                }
            } catch (err) {
                handleApplePayUnavailable();
            }
        }

        console.log('✅ About to check conditions');
        console.log('Conditions:', {
            adyenEnvironment: !!adyenEnvironment,
            adyenPaymentMethods: !!adyenPaymentMethods, 
            basket: !!basket,
            shippingMethods: !!shippingMethods,
            paymentContainer: !!paymentContainer.current
        });

        // Debug missing data
        console.log('🔍 Missing data details:');
        if (!basket) console.log('❌ basket is:', basket);
        if (!shippingMethods) console.log('❌ shippingMethods is:', shippingMethods);

        // Check if core requirements are met (environment and payment methods)
        const coreRequirementsMet = adyenEnvironment && adyenPaymentMethods && paymentContainer.current;

        if (coreRequirementsMet) {
            console.log('✅ Core requirements met, calling createCheckout');
            console.log('ℹ️  Note: basket and shippingMethods will be checked inside createCheckout if needed');
            createCheckout()
        } else {
            console.log('❌ Core requirements not met, skipping createCheckout');
            console.log('Missing:', {
                adyenEnvironment: !adyenEnvironment,
                adyenPaymentMethods: !adyenPaymentMethods,
                paymentContainer: !paymentContainer.current
            });
        }

        // Cleanup function
        return () => {
            console.log(`🧹 CLEANUP INSTANCE: ${instanceId}`);
            isCancelled = true;
        };
    }, [adyenEnvironment, adyenPaymentMethods])

    return (
        <>
            {props.showLoading && (
                <Flex align={'center'} justify={'center'}>
                    <Spinner size={'lg'} mt={4} />
                </Flex>
            )}
            <div ref={paymentContainer}></div>
        </>
    )
}

ApplePayExpress.propTypes = {
    showLoading: PropTypes.bool,
    shippingMethods: PropTypes.array
}
