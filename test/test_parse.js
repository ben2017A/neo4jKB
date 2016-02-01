suite('parse', function() {

  suite('beautify', function() {
    test('(neoRes, KB.parseUser)', function() {
      KB.beautify(A.neoRes, KB.parseUser).should.equal('```\na\n\n---\n\nname: alice\nid: ID0000001\nemail_address: alice@email.com\n\n---\n\nname: bob\nid: ID0000002\nemail_address: bob@email.com\n\n---\n\nname: slackbot\nreal_name: slackbot\nid: USLACKBOT\nemail_address: null\n\n---\n\n\n```')
    })
  })

  suite('transBeautify', function() {
    test('(transNeoRes)', function() {
      KB.transBeautify(KB.transform(A.neoRes, KB.parseUser)).should.equal('```\na\n\n---\n\nname: alice\nid: ID0000001\nemail_address: alice@email.com\n\n---\n\nname: bob\nid: ID0000002\nemail_address: bob@email.com\n\n---\n\nname: slackbot\nreal_name: slackbot\nid: USLACKBOT\nemail_address: null\n\n---\n\n\n```')
    })
  })

  suite('transform', function() {
    test('(neoRes, KB.parseUser)', function() {
      KB.transform(A.neoRes, KB.parseUser).should.eql([
        [
          ['a'],
          ['name: alice\nid: ID0000001\nemail_address: alice@email.com',
            'name: bob\nid: ID0000002\nemail_address: bob@email.com',
            'name: slackbot\nreal_name: slackbot\nid: USLACKBOT\nemail_address: null'
          ]
        ]
      ])
    })
  })

  suite('transform**', function() {
    test('(transform(neoRes), KB.parseUser)', function() {
      KB.transform(A.neoRes, KB.parseUser).should.eql([
        [
          ['a'],
          ['name: alice\nid: ID0000001\nemail_address: alice@email.com',
            'name: bob\nid: ID0000002\nemail_address: bob@email.com',
            'name: slackbot\nreal_name: slackbot\nid: USLACKBOT\nemail_address: null'
          ]
        ]
      ])
    })
  })

  suite('transform[**]', function() {
    test('(transform(neoRes, [KB.cleanUser, KB.parseUser])', function() {
      KB.transform(A.neoRes, [KB.cleanUser, KB.parseUser]).should.eql([
        [
          ['a'],
          ['name: alice\nid: ID0000001\nemail_address: alice@email.com',
            'name: bob\nid: ID0000002\nemail_address: bob@email.com',
            'name: slackbot\nreal_name: slackbot\nid: USLACKBOT\nemail_address: null'
          ]
        ]
      ])
    })
  })

  suite('parseKV', function() {
    test('(obj)', function() {
      KB.parseKV(A.obj).should.equal('a: 0\nb: {\n  "c": 1\n}\nd: [\n  2,\n  3,\n  4\n]')
    })
  })

  suite('cleanUser', function() {
    test('(user)', function() {
      KB.cleanUser(A.user).should.eql({
        "id": "ID0000001",
        "name": "alice",
        "email_address": "alice@email.com",
      })
    })
  })

  suite('parseUser', function() {
    test('(user)', function() {
      KB.parseUser(A.user).should.equal('name: alice\nid: ID0000001\nemail_address: alice@email.com')
    })
  })

  suite('parseObj', function() {
    test('(obj)', function() {
      KB.parseObj(A.user, ['name', 'real_name', 'id', 'email_address']).should.equal('name: alice\nid: ID0000001\nemail_address: alice@email.com')
    })
  })

})


suite('query helpers', function() {

  suite('leftJoin', function() {
    test('(propArr, match)', function() {
      KB.leftJoin(['name', 'real_name', 'a.id', 'a.email_address'], '=~ "(?i).*alice.*"').should.equal(' a.name=~ "(?i).*alice.*" OR a.real_name=~ "(?i).*alice.*" OR a.id=~ "(?i).*alice.*" OR a.email_address=~ "(?i).*alice.*"')
    })

    test('(propArr, match, boolOp)', function() {
      KB.leftJoin(['name', 'real_name', 'a.id', 'a.email_address'], '=~ "(?i).*alice.*"', 'AND').should.equal(' a.name=~ "(?i).*alice.*" AND a.real_name=~ "(?i).*alice.*" AND a.id=~ "(?i).*alice.*" AND a.email_address=~ "(?i).*alice.*"')
    })

  })
})
