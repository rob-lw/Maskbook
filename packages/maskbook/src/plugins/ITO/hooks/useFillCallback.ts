import { useCallback, useState } from 'react'
import BigNumber from 'bignumber.js'
import { sha256 } from 'ethers/lib/utils'
import type { TransactionRequest } from '@ethersproject/providers'
import type { ITO } from '@dimensiondev/contracts/types/ITO'
import type { MaskITO } from '@dimensiondev/contracts/types/MaskITO'
import { TransactionStateType, useTransactionState } from '../../../web3/hooks/useTransactionState'
import { useAccount } from '../../../web3/hooks/useAccount'
import { useITO_Contract } from '../contracts/useITO_Contract'
import type { EtherTokenDetailed, ERC20TokenDetailed } from '../../../web3/types'
import { addGasMargin } from '../../../web3/helpers'
import { gcd, sortTokens } from '../helpers'
import { ITO_CONSTANTS, ITO_CONTRACT_BASE_TIMESTAMP, MASK_ITO_CONTRACT_BASE_TIMESTAMP } from '../constants'
import { useConstant } from '../../../web3/hooks/useConstant'
import Services from '../../../extension/service'
import { useChainId } from '../../../web3/hooks/useChainState'
import { StageType } from '../../../extension/background-script/EthereumService'

export interface PoolSettings {
    isMask: boolean
    password: string
    startTime: Date
    endTime: Date
    title: string
    name: string
    limit: string
    total: string
    exchangeAmounts: string[]
    exchangeTokens: (EtherTokenDetailed | ERC20TokenDetailed)[]
    token?: ERC20TokenDetailed
    testNums: number[]
}

export function useFillCallback(poolSettings?: PoolSettings) {
    const account = useAccount()
    const chainId = useChainId()
    const ITO_Contract = useITO_Contract(poolSettings?.isMask ?? false)
    const DEFAULT_QUALIFICATION_ADDRESS = useConstant(ITO_CONSTANTS, 'DEFAULT_QUALIFICATION_ADDRESS')

    const [fillState, setFillState] = useTransactionState()
    const [fillSettings, setFillSettings] = useState(poolSettings)

    const fillCallback = useCallback(async () => {
        if (!poolSettings) {
            setFillState({
                type: TransactionStateType.UNKNOWN,
            })
            return
        }

        const {
            isMask,
            password,
            startTime,
            endTime,
            name,
            title,
            token,
            total,
            limit,
            exchangeAmounts: exchangeAmountsUnsorted,
            exchangeTokens: exchangeTokensUnsorted,
        } = poolSettings

        if (!token || !ITO_Contract) {
            setFillState({
                type: TransactionStateType.UNKNOWN,
            })
            return
        }

        // sort amounts and tokens
        const sorted = exchangeAmountsUnsorted
            .map((x, i) => ({
                amount: x,
                token: exchangeTokensUnsorted[i],
            }))
            .sort((unsortedA, unsortedB) => sortTokens(unsortedA.token, unsortedB.token))

        const exchangeAmounts = sorted.map((x) => x.amount)
        const exchangeTokens = sorted.map((x) => x.token)

        const BASE_TIMESTAMP = isMask ? MASK_ITO_CONTRACT_BASE_TIMESTAMP : ITO_CONTRACT_BASE_TIMESTAMP
        const startTime_ = Math.floor((startTime.getTime() - BASE_TIMESTAMP) / 1000)
        const endTime_ = Math.floor((endTime.getTime() - BASE_TIMESTAMP) / 1000)
        const now_ = Math.floor((Date.now() - BASE_TIMESTAMP) / 1000)

        // error: the start time before BASE TIMESTAMP
        if (startTime_ < 0) {
            setFillState({
                type: TransactionStateType.FAILED,
                error: new Error('Invalid start time.'),
            })
            return
        }

        // error: the end time before BASE TIMESTAMP
        if (endTime_ < 0) {
            setFillState({
                type: TransactionStateType.FAILED,
                error: new Error('Invalid end time.'),
            })
            return
        }

        // error: the start time after the end time
        if (startTime_ >= endTime_) {
            setFillState({
                type: TransactionStateType.FAILED,
                error: new Error('The start date should before the end date.'),
            })
            return
        }

        // error: the end time before now
        if (endTime_ <= now_) {
            setFillState({
                type: TransactionStateType.FAILED,
                error: new Error('The end date should be a future date.'),
            })
            return
        }

        // error: limit greater than the total supply
        if (new BigNumber(limit).gt(total)) {
            setFillState({
                type: TransactionStateType.FAILED,
                error: new Error('Limits should less than the total supply.'),
            })
            return
        }

        // error: exceed the max available total supply
        if (new BigNumber(total).gt(new BigNumber('2e128'))) {
            setFillState({
                type: TransactionStateType.FAILED,
                error: new Error('Exceed the max available total supply'),
            })
            return
        }

        // error: The size of amounts and the size of tokens not match
        if (exchangeAmounts.length !== exchangeTokens.length) {
            setFillState({
                type: TransactionStateType.FAILED,
                error: new Error('Cannot match amounts with tokens.'),
            })
            return
        }

        // error: token amount is not enough for dividing into integral pieces
        const ONE_TOKEN = new BigNumber(1).multipliedBy(new BigNumber(10).pow(token.decimals ?? 0))
        const exchangeAmountsDivided = exchangeAmounts.map((x, i) => {
            const amount = new BigNumber(x)
            const divisor = gcd(ONE_TOKEN, amount)
            return [amount.div(divisor), ONE_TOKEN.div(divisor)] as const
        })
        const totalAmount = new BigNumber(total)
        const invalidTokenAt = exchangeAmountsDivided.findIndex(([tokenAmountA, tokenAmountB]) =>
            totalAmount.multipliedBy(tokenAmountA).div(tokenAmountB).isZero(),
        )
        if (invalidTokenAt >= 0) {
            setFillState({
                type: TransactionStateType.FAILED,
                error: new Error(
                    `Cannot swap enough ${token.symbol ?? ''} out with ${exchangeTokens[invalidTokenAt].symbol ?? ''}`,
                ),
            })
            return
        }

        // error: unable to sign password
        let signedPassword = ''
        try {
            signedPassword = await Services.Ethereum.sign(password, account, chainId)
        } catch (e) {
            signedPassword = ''
        }
        if (!signedPassword) {
            setFillState({
                type: TransactionStateType.FAILED,
                error: new Error('Failed to sign password.'),
            })
            return
        }

        // the given settings is valid
        setFillSettings({
            ...poolSettings,
            startTime: new Date(startTime_ * 1000),
            endTime: new Date(endTime_ * 1000),
            password: signedPassword,
        })

        // pre-step: start waiting for provider to confirm tx
        setFillState({
            type: TransactionStateType.WAIT_FOR_CONFIRMING,
        })

        const request: TransactionRequest = {
            from: account,
            to: ITO_Contract.options.address,
            value: '0',
        }
        let params = isMask
            ? ([
                sha256(signedPassword)!,
                  startTime_,
                  endTime_,
                  name,
                  title,
                  exchangeTokens.map((x) => x.address),
                exchangeAmountsDivided.flatMap((x) => x).map((y) => y.toString()),
                  token.address,
                  total,
                  limit,
                  DEFAULT_QUALIFICATION_ADDRESS,
            ] as Parameters<MaskITO['fill_pool']>)
            : ([
                sha256(signedPassword)!,
                  startTime_,
                  endTime_,
                  name,
                  title,
                  exchangeTokens.map((x) => x.address),
                exchangeAmountsDivided.flatMap((x) => x).map((y) => y.toString()),
                  token.address,
                  total,
                  limit,
                  DEFAULT_QUALIFICATION_ADDRESS,
            ] as Parameters<ITO['fill_pool']>)

        // step 1: estimate gas
        const estimatedGas = await ITO_Contract.estimateGas.fill_pool(...params).catch((error: Error) => {
            setFillState({
                type: TransactionStateType.FAILED,
                error,
            })
            throw error
        })

        // step 2: blocking
        return new Promise<void>(async (resolve, reject) => {
            const transaction = await ITO_Contract.fill_pool(...params, {
                gas: estimatedGas,
            })

            for await (const stage of Services.Ethereum.watchTransaction(account, transaction)) {
                switch (stage.type) {
                    case StageType.RECEIPT:
                        setFillState({
                            type: TransactionStateType.CONFIRMED,
                            no: 0,
                            receipt: stage.receipt,
                        })
                        break
                    case StageType.CONFIRMATION:
                        setFillState({
                            type: TransactionStateType.CONFIRMED,
                            no: stage.no,
                            receipt: stage.receipt,
                        })
                        resolve()
                        break
                    case StageType.ERROR:
                        setFillState({
                            type: TransactionStateType.FAILED,
                            error: stage.error,
                        })
                        reject(stage.error)
                        break
                }
            }
        })
    }, [account, chainId, ITO_Contract, DEFAULT_QUALIFICATION_ADDRESS, poolSettings])

    const resetCallback = useCallback(() => {
        setFillState({
            type: TransactionStateType.UNKNOWN,
        })
    }, [])

    return [fillSettings, fillState, fillCallback, resetCallback] as const
}
