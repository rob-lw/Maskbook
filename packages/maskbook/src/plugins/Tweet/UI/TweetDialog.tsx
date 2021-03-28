import { useEffect, useState } from 'react'
import { makeStyles, createStyles, Button } from '@material-ui/core'
import * as TweetAPI from '../apis/index'
import { ETHIcon } from '../Icons/ETH'
import { VCentIcon } from '../Icons/VCent'
import { VALUABLES_VCENT_URL } from '../constants'

const useStyles = makeStyles((theme) => ({
    root: {
        marginTop: 20,
    },

    content: {
        backgroundColor: '#f3f3f3',
        color: '#f3f3f3',
        display: 'flex',
        height: 45,
        alignItems: 'center',
        borderRadius: 25,
        justifyContent: 'space-between',
    },

    VCent: {
        marginLeft: -10,
        marginTop: 5,
    },

    bidInfo: {
        color: '#6b6b6b',
        display: 'flex',
        fontSize: 16,
        alignItems: 'center',
        borderWidth: 2,
        marginRight: 15,
        flexDirection: 'row',
        justifyContent: 'center',
    },

    textUSD: {
        color: '#1d1d1d',
        fontSize: 15,
        fontWeight: 400,
        borderWidth: 2,
        marginRight: 5,
    },

    textETH: {
        color: '#6b6b6b',
        display: 'flex',
        fontSize: 15,
        alignItems: 'center',
        fontWeight: 400,
        flexDirection: 'row',
        justifyContent: 'center',
    },

    text: {
        color: '#1d1d1d',
        height: 13,
        fontSize: 13,
        fontWeight: 500,
        marginRight: 5,
        borderWidth: 2,
        marginBottom: 5.5,
    },

    typography: {
        padding: theme.spacing(2),
    },

    paper: {
        padding: theme.spacing(1),
      },
}))

export default function TweetDialog(tweetAddress: any) {
    const classes = useStyles()
    const [tweet, setTweets] = useState<TweetAPI.TweetData>()
    const [type, setType] = useState('')

    useEffect(() => {
        TweetAPI.getTweetData(tweetAddress).then((res) => {
            setTweets(res.results[0])
            setType(res.results[0].type)
        })
    }, [])

    return (
        <div className={classes.root}>
            {tweet && type === 'Offer' ? (
                <Button className={classes.content} target="_blank" href={VALUABLES_VCENT_URL + tweet.tweet_id} style={{backgroundColor: '#f3f3f3'}}>
                    <div className={classes.VCent} >
                        <VCentIcon />
                    </div>
                    <div className={classes.bidInfo}>
                        <div className={classes.text}> LATEST OFFER at</div>
                        <div className={classes.textUSD}>${tweet.amount_usd}</div>
                        <div className={classes.textETH}>
                            (<ETHIcon />
                            {tweet.amount_eth.toFixed(4)})
                        </div>
                    </div>
                </Button>
            ) : null}
        </div>
    )
}
